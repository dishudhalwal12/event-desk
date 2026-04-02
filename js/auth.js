import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { showToast, validateEmail } from './utils.js';

const GOOGLE_ROLE_STORAGE_KEY = 'eventdesk-google-role';
const PENDING_SIGNUP_STORAGE_KEY = 'eventdesk-pending-signup';
const LAST_ROLE_STORAGE_KEY = 'eventdesk-last-role';
const PROFILE_RETRY_DELAYS_MS = [0, 300, 900, 1800];
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

function routeUserByRole(role = 'student') {
  window.localStorage.setItem(LAST_ROLE_STORAGE_KEY, role);
  clearPendingSignup();
  window.location.href = role === 'organizer' ? 'organizer-dashboard.html' : 'student-dashboard.html';
}

function normalizeRole(role) {
  return role === 'organizer' || role === 'student' ? role : '';
}

function storeGoogleRole(role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    window.sessionStorage.removeItem(GOOGLE_ROLE_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(GOOGLE_ROLE_STORAGE_KEY, normalizedRole);
}

function consumeGoogleRole(fallbackRole = '') {
  const role = normalizeRole(window.sessionStorage.getItem(GOOGLE_ROLE_STORAGE_KEY)) || normalizeRole(fallbackRole);
  window.sessionStorage.removeItem(GOOGLE_ROLE_STORAGE_KEY);
  return role;
}

function savePendingSignup(payload) {
  window.sessionStorage.setItem(PENDING_SIGNUP_STORAGE_KEY, JSON.stringify(payload));
}

function readPendingSignup() {
  const raw = window.sessionStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    window.sessionStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
    return null;
  }
}

function clearPendingSignup() {
  window.sessionStorage.removeItem(PENDING_SIGNUP_STORAGE_KEY);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRetriableProfileError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code.includes('unavailable')
    || code.includes('deadline-exceeded')
    || code.includes('network-request-failed')
    || code.includes('failed-precondition')
    || code.includes('permission-denied')
    || message.includes('offline')
    || message.includes('transport errored')
  );
}

function buildFallbackProfile(user, preferredRole = 'student', overrides = {}) {
  const rememberedRole = window.localStorage.getItem(LAST_ROLE_STORAGE_KEY);
  return {
    uid: user?.uid || '',
    name: overrides.name || user?.displayName || user?.email?.split('@')[0] || 'EventDesk User',
    email: overrides.email || user?.email || '',
    role: overrides.role || rememberedRole || preferredRole || 'student',
    phone: overrides.phone ?? '',
    createdAt: null
  };
}

async function primeAuthenticatedSession(user) {
  if (!user) {
    throw new Error('Missing authenticated user');
  }

  await user.getIdToken(true);
}

async function readProfileSnapshot(profileRef) {
  const snapshot = await getDoc(profileRef);
  return snapshot.exists() ? snapshot.data() : null;
}

function setButtonBusy(button, busyText, isBusy) {
  if (!button) return;

  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent;
  }

  button.disabled = isBusy;
  button.setAttribute('aria-busy', String(isBusy));
  button.classList.toggle('is-loading', isBusy);
  button.textContent = isBusy ? busyText : button.dataset.defaultText;
}

function setButtonsBusy(buttons, busyTextById, isBusy) {
  buttons.forEach((button) => {
    if (!button) return;
    const busyText = busyTextById?.[button.id] || 'Please wait...';
    setButtonBusy(button, busyText, isBusy);
  });
}

async function ensureUserProfile(user, preferredRole = 'student', overrides = {}) {
  const profileRef = doc(db, 'users', user.uid);
  const fallbackProfile = buildFallbackProfile(user, preferredRole, overrides);

  for (let attempt = 0; attempt < PROFILE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (PROFILE_RETRY_DELAYS_MS[attempt] > 0) {
        await delay(PROFILE_RETRY_DELAYS_MS[attempt]);
      }

      await primeAuthenticatedSession(user);

      const currentProfile = await readProfileSnapshot(profileRef);
      if (currentProfile) {
        // Only repair if fields are actually missing — avoid unnecessary Firestore writes
        // that trigger onSnapshot cascades across the app
        const needsRepair = !currentProfile.uid || !currentProfile.name || !currentProfile.email || !currentProfile.role;
        if (needsRepair) {
          const repairedProfile = {
            uid: currentProfile.uid || user.uid,
            name: currentProfile.name || fallbackProfile.name,
            email: currentProfile.email || fallbackProfile.email,
            role: currentProfile.role || fallbackProfile.role,
            phone: currentProfile.phone || fallbackProfile.phone || '',
            createdAt: currentProfile.createdAt || serverTimestamp()
          };
          await setDoc(profileRef, repairedProfile, { merge: true });
          return {
            ...repairedProfile,
            createdAt: currentProfile.createdAt || null
          };
        }

        // Profile is complete — return it directly with no write
        return {
          uid: currentProfile.uid,
          name: currentProfile.name,
          email: currentProfile.email,
          role: currentProfile.role,
          phone: currentProfile.phone || '',
          createdAt: currentProfile.createdAt || null
        };
      }

      const createdProfile = {
        uid: user.uid,
        name: fallbackProfile.name,
        email: fallbackProfile.email,
        role: fallbackProfile.role,
        phone: fallbackProfile.phone || '',
        createdAt: serverTimestamp()
      };

      await setDoc(profileRef, createdProfile, { merge: true });

      const confirmedProfile = await readProfileSnapshot(profileRef).catch(() => null);
      return confirmedProfile || {
        ...createdProfile,
        createdAt: null
      };
    } catch (error) {
      const isLastAttempt = attempt === PROFILE_RETRY_DELAYS_MS.length - 1;
      if (!isRetriableProfileError(error) || isLastAttempt) {
        throw error;
      }
      console.warn(`Profile sync retry ${attempt + 1} failed:`, error);
    }
  }

  throw new Error('Could not sync profile with Firebase.');
}

async function redirectAuthenticatedUser() {
  if (!auth.currentUser || window.__eventdeskAuthRedirecting) {
    return false;
  }

  window.__eventdeskAuthRedirecting = true;

  try {
    const pendingSignup = readPendingSignup();
    const profile = await ensureUserProfile(
      auth.currentUser,
      pendingSignup?.role || 'student',
      pendingSignup || {}
    );
    routeUserByRole(profile?.role || pendingSignup?.role || 'student');
    return true;
  } finally {
    window.__eventdeskAuthRedirecting = false;
  }
}

async function resolveGoogleRoleForUser(user, preferredRole = '') {
  const explicitRole = normalizeRole(preferredRole);

  try {
    const existingProfile = user?.uid
      ? await readProfileSnapshot(doc(db, 'users', user.uid))
      : null;
    if (existingProfile?.role) {
      return existingProfile.role;
    }
  } catch (error) {
    console.warn('Profile preflight skipped for Google sign-in:', error);
  }

  if (explicitRole) {
    return explicitRole;
  }

  const rememberedRole = normalizeRole(window.localStorage.getItem(LAST_ROLE_STORAGE_KEY));
  if (rememberedRole) {
    return rememberedRole;
  }

  const wantsOrganizer = window.confirm('Continue with Google as an organizer? Click Cancel to continue as a student.');
  return wantsOrganizer ? 'organizer' : 'student';
}

export async function signUpUser(name, email, password, role) {
  savePendingSignup({ name, email, role, phone: '' });
  const credentials = await createUserWithEmailAndPassword(auth, email, password);
  const { user } = credentials;

  await ensureUserProfile(user, role, {
    name,
    email,
    role,
    phone: ''
  });

  routeUserByRole(role);
}

export async function signInUser(email, password) {
  const credentials = await signInWithEmailAndPassword(auth, email, password);
  const pendingSignup = readPendingSignup();
  const profile = await ensureUserProfile(
    credentials.user,
    pendingSignup?.role || 'student',
    {
      name: pendingSignup?.name,
      email: pendingSignup?.email || email,
      role: pendingSignup?.role
    }
  );
  routeUserByRole(profile?.role || pendingSignup?.role || 'student');
}

export async function signInWithGoogle(preferredRole = '') {
  const normalizedRole = normalizeRole(preferredRole);
  storeGoogleRole(normalizedRole);
  if (normalizedRole) {
    savePendingSignup({ role: normalizedRole, phone: '' });
  } else {
    clearPendingSignup();
  }

  try {
    const credentials = await signInWithPopup(auth, googleProvider);
    const resolvedRole = await resolveGoogleRoleForUser(credentials.user, normalizedRole);
    savePendingSignup({ role: resolvedRole, phone: '' });
    const profile = await ensureUserProfile(credentials.user, resolvedRole, { role: resolvedRole });
    consumeGoogleRole(resolvedRole);
    routeUserByRole(profile?.role);
    return true;
  } catch (error) {
    if (
      [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
      ].includes(error?.code)
    ) {
      const redirectRole = normalizedRole || resolveGoogleRoleForUser(auth.currentUser, normalizedRole).catch(() => 'student');
      const safeRole = typeof redirectRole === 'string' ? redirectRole : await redirectRole;
      storeGoogleRole(safeRole);
      savePendingSignup({ role: safeRole, phone: '' });
      await signInWithRedirect(auth, googleProvider);
      return false;
    }

    consumeGoogleRole(normalizedRole);
    throw error;
  }
}

export async function completeGoogleRedirectSignIn() {
  const result = await getRedirectResult(auth);
  if (!result?.user) {
    return false;
  }

  const preferredRole = consumeGoogleRole('');
  const resolvedRole = await resolveGoogleRoleForUser(result.user, preferredRole);
  savePendingSignup({ role: resolvedRole, phone: '' });
  const profile = await ensureUserProfile(result.user, resolvedRole, { role: resolvedRole });
  routeUserByRole(profile?.role);
  return true;
}

export async function signOutUser() {
  await signOut(auth);
  window.location.href = 'index.html';
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
  showToast('Reset link sent! Check your inbox.', 'success');
}

export async function fetchUserProfile(uid) {
  if (!uid) return null;
  const profileRef = doc(db, 'users', uid);
  const currentUser = auth.currentUser?.uid === uid ? auth.currentUser : null;

  for (let attempt = 0; attempt < PROFILE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (PROFILE_RETRY_DELAYS_MS[attempt] > 0) {
        await delay(PROFILE_RETRY_DELAYS_MS[attempt]);
      }

      if (currentUser) {
        await primeAuthenticatedSession(currentUser);
      }

      const profile = await readProfileSnapshot(profileRef);
      if (profile) {
        return profile;
      }

      if (currentUser) {
        return await ensureUserProfile(currentUser);
      }

      return null;
    } catch (error) {
      const isLastAttempt = attempt === PROFILE_RETRY_DELAYS_MS.length - 1;
      if (!isRetriableProfileError(error) || isLastAttempt) {
        throw error;
      }
      console.warn(`Profile fetch retry ${attempt + 1} failed:`, error);
    }
  }

  return null;
}

export function checkAuth(requiredRole) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();

      if (!user) {
        window.location.href = 'login.html';
        reject(new Error('Unauthenticated'));
        return;
      }

      let profile;
      try {
        profile = await fetchUserProfile(user.uid);
      } catch (error) {
        reject(error);
        return;
      }

      if (!profile) {
        try {
          profile = await ensureUserProfile(user, window.localStorage.getItem(LAST_ROLE_STORAGE_KEY) || 'student');
        } catch (error) {
          window.location.href = 'login.html';
          reject(error);
          return;
        }
      }

      if (requiredRole && profile.role !== requiredRole) {
        routeUserByRole(profile.role);
        reject(new Error('Role mismatch'));
        return;
      }

      resolve({ user, profile });
    });
  });
}

function handleAuthError(error) {
  const code = error?.code || '';
  const message = String(error?.message || '');
  if (code.includes('auth/user-not-found') || code.includes('auth/invalid-credential')) {
    showToast('No account with this email. Sign up first!', 'error');
    return;
  }
  if (code.includes('auth/wrong-password')) {
    showToast('Wrong password. Try again.', 'error');
    return;
  }
  if (code.includes('auth/too-many-requests')) {
    showToast('Too many attempts. Try again in a few minutes.', 'error');
    return;
  }
  if (code.includes('auth/email-already-in-use')) {
    showToast('This email is already in use. Try signing in instead.', 'error');
    return;
  }
  if (code.includes('auth/account-exists-with-different-credential')) {
    showToast('This email already exists with another sign-in method.', 'error');
    return;
  }
  if (code.includes('auth/network-request-failed') || message.includes('client is offline')) {
    showToast('Network looks unstable right now. Firebase could not reach the server. 📶', 'warning');
    return;
  }
  if (code.includes('permission-denied')) {
    showToast('Firestore rules blocked the profile sync. Please deploy the latest rules and try again.', 'error');
    return;
  }
  showToast(error?.message || 'Something went wrong. Please try again.', 'error');
}

function togglePassword(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;

  button.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    button.textContent = isPassword ? 'Hide' : 'Show';
  });
}

function warnIfFileProtocol() {
  if (window.location.protocol === 'file:') {
    showToast('Open EventDesk through localhost or Firebase Hosting. Auth often fails from a raw file tab. 🌐', 'warning');
  }
}

export function initSignupPage() {
  const roleCards = document.querySelectorAll('.role-card');
  const roleSelectionStep = document.getElementById('roleSelectionStep');
  const signupFormStep = document.getElementById('signupFormStep');
  const selectedRoleBadge = document.getElementById('selectedRoleBadge');
  const changeRoleButton = document.getElementById('changeRoleButton');
  const signupForm = document.getElementById('signupForm');
  const googleButton = document.getElementById('signupWithGoogleButton');
  const submitButton = signupForm?.querySelector('button[type="submit"]');
  let selectedRole = 'student';

  warnIfFileProtocol();
  togglePassword('signupPassword', 'toggleSignupPassword');
  completeGoogleRedirectSignIn().catch(handleAuthError);
  redirectAuthenticatedUser().catch(() => {});
  onAuthStateChanged(auth, (user) => {
    if (user) {
      redirectAuthenticatedUser().catch(handleAuthError);
    }
  });

  roleCards.forEach((card) => {
    card.addEventListener('click', () => {
      roleCards.forEach((item) => item.classList.remove('active'));
      card.classList.add('active');
      selectedRole = card.dataset.role;
      selectedRoleBadge.textContent = selectedRole === 'organizer' ? 'Organizer' : 'Student';
      roleSelectionStep.classList.add('d-none');
      signupFormStep.classList.remove('d-none');
    });
  });

  changeRoleButton?.addEventListener('click', () => {
    signupFormStep.classList.add('d-none');
    roleSelectionStep.classList.remove('d-none');
  });

  googleButton?.addEventListener('click', async () => {
    setButtonsBusy(
      [submitButton, googleButton],
      {
        loginSubmitButton: 'Signing in...',
        signupSubmitButton: 'Creating account...',
        signupWithGoogleButton: 'Opening Google...',
      },
      true
    );

    try {
      await signInWithGoogle(selectedRole);
    } catch (error) {
      handleAuthError(error);
      setButtonsBusy(
        [submitButton, googleButton],
        {
          loginSubmitButton: 'Signing in...',
          signupSubmitButton: 'Creating account...',
          signupWithGoogleButton: 'Opening Google...',
        },
        false
      );
    }
  });

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!name || !validateEmail(email) || password.length < 6) {
      showToast('Please fill every field properly before continuing.', 'error');
      return;
    }

    setButtonsBusy(
      [submitButton, googleButton],
      {
        loginSubmitButton: 'Signing in...',
        signupSubmitButton: 'Creating account...',
        signupWithGoogleButton: 'Opening Google...',
      },
      true
    );

    try {
      await signUpUser(name, email, password, selectedRole);
    } catch (error) {
      if (String(error?.code || '').includes('auth/email-already-in-use')) {
        try {
          await signInUser(email, password);
          showToast('Account already existed, so you were signed in automatically.', 'success');
          return;
        } catch (signInError) {
          handleAuthError(signInError);
        }
      } else {
        handleAuthError(error);
      }
    } finally {
      setButtonsBusy(
        [submitButton, googleButton],
        {
          loginSubmitButton: 'Signing in...',
          signupSubmitButton: 'Creating account...',
          signupWithGoogleButton: 'Opening Google...',
        },
        false
      );
    }
  });
}

export function initLoginPage() {
  const loginForm = document.getElementById('loginForm');
  const forgotPasswordButton = document.getElementById('forgotPasswordButton');
  const passwordResetForm = document.getElementById('passwordResetForm');
  const googleButton = document.getElementById('loginWithGoogleButton');
  const submitButton = loginForm?.querySelector('button[type="submit"]');

  warnIfFileProtocol();
  togglePassword('loginPassword', 'toggleLoginPassword');
  completeGoogleRedirectSignIn().catch(handleAuthError);
  redirectAuthenticatedUser().catch(() => {});
  onAuthStateChanged(auth, (user) => {
    if (user) {
      redirectAuthenticatedUser().catch(handleAuthError);
    }
  });

  forgotPasswordButton?.addEventListener('click', () => {
    passwordResetForm?.classList.toggle('d-none');
    document.getElementById('resetEmail').value = document.getElementById('loginEmail').value.trim();
  });

  passwordResetForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    if (!validateEmail(email)) {
      showToast('Enter a valid email address first.', 'error');
      return;
    }

    try {
      await resetPassword(email);
      passwordResetForm.classList.add('d-none');
    } catch (error) {
      handleAuthError(error);
    }
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    setButtonsBusy(
      [submitButton, googleButton],
      {
        loginWithGoogleButton: 'Opening Google...',
        loginSubmitButton: 'Signing in...',
        signupSubmitButton: 'Creating account...'
      },
      true
    );

    try {
      await signInUser(email, password);
    } catch (error) {
      handleAuthError(error);
    } finally {
      setButtonsBusy(
      [submitButton, googleButton],
      {
        loginWithGoogleButton: 'Opening Google...',
        loginSubmitButton: 'Signing in...',
        signupSubmitButton: 'Creating account...'
      },
      false
    );
    }
  });

  googleButton?.addEventListener('click', async () => {
    setButtonsBusy(
      [submitButton, googleButton],
      {
        loginWithGoogleButton: 'Opening Google...',
        loginSubmitButton: 'Signing in...',
        signupSubmitButton: 'Creating account...'
      },
      true
    );

    try {
      await signInWithGoogle();
    } catch (error) {
      handleAuthError(error);
      setButtonsBusy(
        [submitButton, googleButton],
        {
          loginWithGoogleButton: 'Opening Google...',
          loginSubmitButton: 'Signing in...',
          signupSubmitButton: 'Creating account...'
        },
        false
      );
    }
  });
}
