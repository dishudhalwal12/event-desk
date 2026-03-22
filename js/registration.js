import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { checkAuth, fetchUserProfile, signOutUser } from './auth.js';
import { generateCertificate } from './certificate.js';
import { sendConfirmationEmail, sendWaitlistNotification } from './email.js';
import {
  formatDate,
  formatShortDate,
  getInitials,
  hasCustomPoster,
  hideLoadingSpinner,
  showLoadingSpinner,
  showToast
} from './utils.js';
import { getUserRank } from './leaderboard.js';

const certificateStoragePrefix = 'eventdesk-certificates-';

function getStoredCertificates(userId) {
  const raw = window.localStorage.getItem(`${certificateStoragePrefix}${userId}`);
  return raw ? JSON.parse(raw) : [];
}

function saveStoredCertificates(userId, values) {
  window.localStorage.setItem(`${certificateStoragePrefix}${userId}`, JSON.stringify(values));
}

function getEventMillis(event) {
  if (!event?.date) return 0;
  if (typeof event.date.toDate === 'function') {
    return event.date.toDate().getTime();
  }
  return new Date(event.date).getTime();
}

function getEventDateValue(event) {
  if (!event?.date) return null;
  if (typeof event.date.toDate === 'function') {
    return event.date.toDate();
  }
  return new Date(event.date);
}

function formatTimeValue(timestamp) {
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatActivityTime(timestamp) {
  if (!timestamp) return 'Just now';
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(Math.round(diff / 60000), 0);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} day ago`;
}

async function getEventSnapshot(eventId) {
  return getDoc(doc(db, 'events', eventId));
}

async function getExistingRegistration(userId, eventId) {
  const existingQuery = query(
    collection(db, 'registrations'),
    where('userId', '==', userId),
    where('eventId', '==', eventId)
  );
  const existingSnapshot = await getDocs(existingQuery);
  return existingSnapshot.docs.find((item) => item.data().status !== 'cancelled') || null;
}

async function renumberWaitlist(eventId) {
  const waitlistQuery = query(
    collection(db, 'registrations'),
    where('eventId', '==', eventId),
    where('status', '==', 'waitlisted')
  );
  const waitlistSnapshot = await getDocs(waitlistQuery);
  const sorted = waitlistSnapshot.docs
    .sort((left, right) => (left.data().waitlistPos || 0) - (right.data().waitlistPos || 0));

  const batch = writeBatch(db);
  sorted.forEach((item, index) => {
    batch.update(item.ref, { waitlistPos: index + 1 });
  });
  await batch.commit();
}

function buildTeamPayload(userId, userProfile, phone, teamOptions = {}) {
  const lead = {
    userId,
    name: userProfile?.name || 'Student',
    email: auth.currentUser?.email || userProfile?.email || '',
    phone,
    isLeader: true
  };

  const additionalMembers = Array.isArray(teamOptions.teamMembers)
    ? teamOptions.teamMembers
      .map((member) => ({
        name: String(member?.name || '').trim(),
        email: String(member?.email || '').trim(),
        isLeader: false
      }))
      .filter((member) => member.name && member.email)
    : [];

  const participantCount = Math.max(1, Math.min(Number(teamOptions.teamSize) || 1, additionalMembers.length + 1, 4));
  const teamMembers = [lead, ...additionalMembers].slice(0, participantCount);

  return {
    teamName: String(teamOptions.teamName || '').trim(),
    participantCount: teamMembers.length,
    teamMembers
  };
}

export async function addToWaitlist(userId, eventId, phone, teamOptions = {}) {
  const existingRegistration = await getExistingRegistration(userId, eventId);
  if (existingRegistration?.data()?.status === 'waitlisted') {
    return {
      waitlisted: true,
      position: existingRegistration.data().waitlistPos,
      registrationId: existingRegistration.id
    };
  }

  const userProfile = await fetchUserProfile(userId);
  const teamPayload = buildTeamPayload(userId, userProfile, phone, teamOptions);
  const waitlistQuery = query(
    collection(db, 'registrations'),
    where('eventId', '==', eventId),
    where('status', '==', 'waitlisted')
  );
  const waitlistSnapshot = await getDocs(waitlistQuery);
  const registrationRef = doc(collection(db, 'registrations'));
  const position = waitlistSnapshot.size + 1;

  await setDoc(registrationRef, {
    registrationId: registrationRef.id,
    userId,
    eventId,
    name: userProfile?.name || 'Student',
    email: auth.currentUser?.email || userProfile?.email || '',
    phone,
    qrCode: JSON.stringify({ regId: registrationRef.id, userId, eventId }),
    teamName: teamPayload.teamName || null,
    participantCount: teamPayload.participantCount,
    teamMembers: teamPayload.teamMembers,
    status: 'waitlisted',
    waitlistPos: position,
    registeredAt: serverTimestamp()
  });

  await updateDoc(doc(db, 'users', userId), { phone });
  return { waitlisted: true, position, registrationId: registrationRef.id };
}

export async function registerStudent(userId, eventId, phone, teamOptions = {}) {
  const eventRef = doc(db, 'events', eventId);
  const registrationRef = doc(collection(db, 'registrations'));
  const userProfile = await fetchUserProfile(userId);
  const eventSnapshot = await getEventSnapshot(eventId);
  const eventData = eventSnapshot.exists() ? eventSnapshot.data() : null;

  if (!eventData) {
    throw new Error('Event not found');
  }

  const existingRegistration = await getExistingRegistration(userId, eventId);
  if (existingRegistration) {
    const data = existingRegistration.data();
    if (data.status === 'registered') {
      return { success: true, registrationId: existingRegistration.id, alreadyRegistered: true };
    }
    if (data.status === 'waitlisted') {
      return { waitlisted: true, position: data.waitlistPos, registrationId: existingRegistration.id };
    }
  }

  let shouldWaitlist = false;
  const teamPayload = buildTeamPayload(userId, userProfile, phone, teamOptions);

  await runTransaction(db, async (transaction) => {
    const currentEvent = await transaction.get(eventRef);
    if (!currentEvent.exists()) {
      throw new Error('Event not found');
    }

    const currentData = currentEvent.data();
    if (currentData.registeredCount >= currentData.seatCap) {
      shouldWaitlist = true;
      return;
    }

    const qrCode = JSON.stringify({ regId: registrationRef.id, userId, eventId });
    transaction.set(registrationRef, {
      registrationId: registrationRef.id,
      userId,
      eventId,
      name: userProfile?.name || 'Student',
      email: auth.currentUser?.email || userProfile?.email || '',
      phone,
      qrCode,
      teamName: teamPayload.teamName || null,
      participantCount: teamPayload.participantCount,
      teamMembers: teamPayload.teamMembers,
      status: 'registered',
      waitlistPos: null,
      registeredAt: serverTimestamp()
    });
    transaction.update(eventRef, {
      registeredCount: currentData.registeredCount + 1
    });
  });

  if (shouldWaitlist) {
    return addToWaitlist(userId, eventId, phone, teamOptions);
  }

  await updateDoc(doc(db, 'users', userId), { phone });
  await sendConfirmationEmail(
    userProfile?.name || 'Student',
    auth.currentUser?.email || userProfile?.email || '',
    eventData.title,
    formatDate(eventData.date),
    eventData.venue,
    JSON.stringify({ regId: registrationRef.id, userId, eventId })
  ).catch((error) => console.warn('Email skipped:', error));

  return { success: true, registrationId: registrationRef.id };
}

export async function cancelRegistration(registrationId, eventId) {
  const registrationRef = doc(db, 'registrations', registrationId);
  const eventRef = doc(db, 'events', eventId);
  let cancelledStatus = null;

  await runTransaction(db, async (transaction) => {
    const registrationSnapshot = await transaction.get(registrationRef);
    const eventSnapshot = await transaction.get(eventRef);
    if (!registrationSnapshot.exists() || !eventSnapshot.exists()) {
      throw new Error('Registration not found');
    }

    const registration = registrationSnapshot.data();
    const eventData = eventSnapshot.data();
    cancelledStatus = registration.status;
    transaction.update(registrationRef, { status: 'cancelled' });

    if (registration.status === 'registered') {
      transaction.update(eventRef, {
        registeredCount: Math.max((eventData.registeredCount || 1) - 1, 0)
      });
    }
  });

  if (cancelledStatus === 'waitlisted') {
    await renumberWaitlist(eventId);
  }
}

export async function promoteFromWaitlist(eventId, registrationId) {
  const registrationRef = doc(db, 'registrations', registrationId);
  const eventRef = doc(db, 'events', eventId);

  await runTransaction(db, async (transaction) => {
    const registrationSnapshot = await transaction.get(registrationRef);
    const eventSnapshot = await transaction.get(eventRef);
    if (!registrationSnapshot.exists() || !eventSnapshot.exists()) {
      throw new Error('Waitlist entry not found');
    }

    const registration = registrationSnapshot.data();
    const eventData = eventSnapshot.data();

    if (eventData.registeredCount >= eventData.seatCap) {
      throw new Error('This event is full 😔 Try the waitlist!');
    }

    transaction.update(registrationRef, {
      status: 'registered',
      waitlistPos: null
    });
    transaction.update(eventRef, {
      registeredCount: eventData.registeredCount + 1
    });
  });

  await renumberWaitlist(eventId);

  const registrationSnapshot = await getDoc(registrationRef);
  const eventSnapshot = await getDoc(eventRef);
  const registration = registrationSnapshot.data();
  const eventData = eventSnapshot.data();

  await sendWaitlistNotification(
    registration.name,
    registration.email || '',
    eventData.title,
    `${window.location.origin}/event-detail.html?id=${eventId}`
  ).catch((error) => console.warn('Waitlist email skipped:', error));

  return {
    name: registration.name
  };
}

export async function getStudentRegistrations(userId) {
  const registrationsQuery = query(
    collection(db, 'registrations'),
    where('userId', '==', userId)
  );
  const registrationsSnapshot = await getDocs(registrationsQuery);
  const registrations = await Promise.all(
    registrationsSnapshot.docs.map(async (item) => {
      const data = item.data();
      const eventSnapshot = await getDoc(doc(db, 'events', data.eventId));
      return {
        ...data,
        registrationId: item.id,
        event: eventSnapshot.exists() ? { id: eventSnapshot.id, ...eventSnapshot.data() } : null
      };
    })
  );

  return registrations.sort((left, right) => getEventMillis(right.event) - getEventMillis(left.event));
}

function renderQrCode(value) {
  const wrapper = document.getElementById('studentQrCode');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  new window.QRCode(wrapper, {
    text: value,
    width: 200,
    height: 200
  });
}

function downloadQrImage() {
  const wrapper = document.getElementById('studentQrCode');
  const canvas = wrapper?.querySelector('canvas');
  const image = wrapper?.querySelector('img');
  const href = canvas?.toDataURL('image/png') || image?.src;
  if (!href) return;

  const link = document.createElement('a');
  link.href = href;
  link.download = 'eventdesk-qr.png';
  link.click();
}

function getCardState(item) {
  if (item.status === 'cancelled') {
    return { label: 'Cancelled', className: 'cancelled', action: 'none' };
  }
  if (item.status === 'waitlisted') {
    return { label: 'Waitlisted ⏳', className: 'waitlisted', action: 'waitlisted' };
  }
  if (item.attended && item.event?.status === 'Completed') {
    return { label: 'Certificate Ready 🏆', className: 'certificate', action: 'certificate' };
  }
  if (item.attended) {
    return { label: 'Attended ✅', className: 'attended', action: 'attended' };
  }
  return { label: 'Upcoming', className: 'upcoming', action: 'qr' };
}

function getStudentStatusCopy(item, state) {
  const teamSummary = item.participantCount > 1
    ? ` Team ${item.teamName ? `"${item.teamName}"` : 'registration'} includes ${item.participantCount} participants.`
    : '';

  if (state.action === 'waitlisted') {
    return `You are #${item.waitlistPos} in queue for this event. If a seat opens, the organizer can promote you straight from their dashboard.${teamSummary}`;
  }
  if (state.action === 'certificate') {
    return `Attendance is confirmed and the organizer has completed the event. Your certificate is ready to download.${teamSummary}`;
  }
  if (state.action === 'attended') {
    return `Your attendance was marked successfully. The certificate unlocks as soon as the organizer marks this event completed.${teamSummary}`;
  }
  if (state.action === 'none') {
    return `You released your spot for this event. If you change your mind later, you can register again if seats are still open.${teamSummary}`;
  }
  return `${item.event?.description || 'Your QR code is ready. Keep it handy for a smooth check-in at the venue.'}${teamSummary}`;
}

function applyStudentPosterPresentation(item, fragment) {
  const poster = fragment.querySelector('.student-event-poster');
  const fallback = fragment.querySelector('.student-poster-fallback');
  const fallbackTitle = fragment.querySelector('.event-poster-fallback-title');
  const fallbackKicker = fragment.querySelector('.event-poster-fallback-kicker');
  const fallbackMeta = fragment.querySelector('.event-poster-fallback-meta');
  const title = item.event?.title || 'Campus Event';
  const category = item.event?.category || 'Campus';

  if (fallbackTitle) fallbackTitle.textContent = title;
  if (fallbackKicker) fallbackKicker.textContent = category;
  if (fallbackMeta) fallbackMeta.textContent = item.event?.venue || 'Fresh campus experiences';

  if (poster && hasCustomPoster(item.event?.posterUrl)) {
    poster.src = item.event.posterUrl;
    poster.alt = `${title} poster`;
    poster.classList.remove('d-none');
    fallback?.classList.add('d-none');
    poster.onerror = () => {
      poster.classList.add('d-none');
      fallback?.classList.remove('d-none');
    };
  } else {
    poster?.classList.add('d-none');
    fallback?.classList.remove('d-none');
  }
}

function applyStudentStats(userId, items, attendedCount, rank) {
  const registeredCount = items.filter((item) => item.status === 'registered').length;
  const downloadedCertificates = getStoredCertificates(userId).length;
  document.getElementById('statRegistered').textContent = registeredCount;
  document.getElementById('statAttended').textContent = attendedCount;
  document.getElementById('statCertificates').textContent = downloadedCertificates;
  document.getElementById('statRank').textContent = rank ? `#${rank}` : '--';
}

function filterStudentItems(items, tab) {
  if (tab === 'upcoming') {
    return items.filter((item) => getCardState(item).action === 'qr' || item.status === 'waitlisted');
  }
  if (tab === 'attended') {
    return items.filter((item) => item.attended && item.event?.status !== 'Completed');
  }
  if (tab === 'certificates') {
    return items.filter((item) => getCardState(item).action === 'certificate');
  }
  return items;
}

function renderEmptyStack(targetId, message) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.classList.add('empty');
  target.innerHTML = `<p class="empty-inline-copy mb-0">${message}</p>`;
}

function renderStudentSidePanels(profile, items, campusEvents, rank) {
  const downloadedCertificates = new Set(getStoredCertificates(auth.currentUser.uid));
  const activeRegistrations = items.filter((item) => item.status !== 'cancelled');
  const phoneValue = profile.phone || activeRegistrations.find((item) => item.phone)?.phone || '';
  const upcomingRegistered = activeRegistrations
    .filter((item) => item.status === 'registered' && getEventMillis(item.event) >= Date.now())
    .sort((left, right) => getEventMillis(left.event) - getEventMillis(right.event));
  const nextEvent = upcomingRegistered[0] || null;
  const waitlistedItems = items
    .filter((item) => item.status === 'waitlisted')
    .sort((left, right) => (left.waitlistPos || 0) - (right.waitlistPos || 0));
  const readyCertificates = items.filter((item) => getCardState(item).action === 'certificate');
  const registeredEventIds = new Set(activeRegistrations.map((item) => item.eventId));
  const recommendations = campusEvents
    .filter((event) => !registeredEventIds.has(event.id) && getEventMillis(event) >= Date.now() && event.status !== 'Completed')
    .sort((left, right) => getEventMillis(left) - getEventMillis(right))
    .slice(0, 3);

  document.getElementById('studentProfileAvatar').textContent = getInitials(profile.name);
  document.getElementById('studentProfileName').textContent = profile.name || 'EventDesk Student';
  document.getElementById('studentProfileEmail').textContent = profile.email || 'student@campus.edu';
  document.getElementById('studentProfilePhone').textContent = phoneValue || 'Add phone during registration';

  const heroBadge = document.getElementById('studentHeroBadge');
  heroBadge.textContent = nextEvent
    ? `Next up: ${nextEvent.event?.title || nextEvent.title}`
    : rank ? `Leaderboard rhythm: rank #${rank}` : 'Live sync with campus events';

  if (nextEvent?.event) {
    document.getElementById('studentSpotlightTag').textContent = 'Next registered event';
    document.getElementById('studentSpotlightTitle').textContent = nextEvent.event.title;
    document.getElementById('studentSpotlightCopy').textContent = getStudentStatusCopy(nextEvent, getCardState(nextEvent));
    document.getElementById('studentSpotlightDate').textContent = `${formatShortDate(nextEvent.event.date)} • ${formatTimeValue(nextEvent.event.date)}`;
    document.getElementById('studentSpotlightVenue').textContent = nextEvent.event.venue || 'Venue TBA';
    document.getElementById('studentSpotlightLink').href = `event-detail.html?id=${nextEvent.eventId}`;
    document.getElementById('studentSpotlightLink').textContent = 'Open Event 👀';
  } else {
    document.getElementById('studentSpotlightTag').textContent = 'No upcoming event';
    document.getElementById('studentSpotlightTitle').textContent = 'Register for an event to see your spotlight here.';
    document.getElementById('studentSpotlightCopy').textContent = 'Your soonest registered event appears here with timing, venue, and a quick path back to the full details.';
    document.getElementById('studentSpotlightDate').textContent = 'Waiting for your next plan';
    document.getElementById('studentSpotlightVenue').textContent = 'Campus-wide';
    document.getElementById('studentSpotlightLink').href = 'events.html';
    document.getElementById('studentSpotlightLink').textContent = 'Browse Events 👀';
  }

  document.getElementById('studentWaitlistCount').textContent = `${waitlistedItems.length} waiting`;
  if (!waitlistedItems.length) {
    renderEmptyStack('studentWaitlistPanel', 'No waitlists right now. If an event fills up, your exact queue position will show here.');
  } else {
    const target = document.getElementById('studentWaitlistPanel');
    target.classList.remove('empty');
    target.innerHTML = waitlistedItems.map((item) => `
      <div class="stack-list-item">
        <strong>${item.event?.title || 'Campus Event'}</strong>
        <span>Queue position #${item.waitlistPos}</span>
        <small>${formatShortDate(item.event?.date)} • ${item.event?.venue || 'Venue TBA'}</small>
        <a href="event-detail.html?id=${item.eventId}">Open Event 👀</a>
      </div>
    `).join('');
  }

  document.getElementById('studentCertificateSummary').textContent = `${readyCertificates.length} ready`;
  if (!readyCertificates.length) {
    renderEmptyStack('studentCertificatesPanel', 'Certificate-ready events show up here the moment the organizer marks them completed.');
  } else {
    const target = document.getElementById('studentCertificatesPanel');
    target.classList.remove('empty');
    target.innerHTML = readyCertificates.slice(0, 3).map((item) => `
      <div class="stack-list-item">
        <strong>${item.event?.title || 'Campus Event'}</strong>
        <span>${downloadedCertificates.has(item.registrationId) ? 'Already downloaded on this device' : 'Ready to download now'}</span>
        <small>${formatShortDate(item.event?.date)} • ${item.event?.venue || 'Venue TBA'}</small>
      </div>
    `).join('');
  }

  if (!recommendations.length) {
    renderEmptyStack('studentRecommendationsList', 'Fresh events from campus will appear here as organizers publish them.');
  } else {
    const target = document.getElementById('studentRecommendationsList');
    target.classList.remove('empty');
    target.innerHTML = recommendations.map((event) => `
      <div class="stack-list-item">
        <strong>${event.title}</strong>
        <span>${event.category} • ${formatShortDate(event.date)}</span>
        <small>${event.venue} • ${Math.max((event.seatCap || 0) - (event.registeredCount || 0), 0)} spots left</small>
        <a href="event-detail.html?id=${event.id}">View Details 👀</a>
      </div>
    `).join('');
  }
}

function renderStudentDashboardItems(items, userProfile, qrModal, onCertificateSaved) {
  const list = document.getElementById('studentEventsList');
  const template = document.getElementById('studentEventCardTemplate');
  const qrModalTitle = document.getElementById('qrModalTitle');
  const qrEventName = document.getElementById('qrEventName');
  const saveQrButton = document.getElementById('saveQrButton');

  list.innerHTML = '';

  if (!items.length) {
    list.innerHTML = `
      <div class="card">
        <div class="card-body text-center py-5">
          <h3 class="mb-2">Nothing here yet</h3>
          <p class="text-muted mb-0">Register for something fun and it will show up here instantly.</p>
        </div>
      </div>
    `;
    return;
  }

  items.forEach((item) => {
    const fragment = template.content.cloneNode(true);
    const state = getCardState(item);
    const eventDate = getEventDateValue(item.event);
    const actionArea = fragment.querySelector('.student-event-actions');
    const detailLink = document.createElement('a');

    applyStudentPosterPresentation(item, fragment);
    fragment.querySelector('.student-event-category').textContent = item.event?.category || 'Campus';
    fragment.querySelector('.dashboard-event-title').textContent = item.event?.title || 'Event removed';
    fragment.querySelector('.dashboard-event-meta').textContent = `${formatShortDate(item.event?.date)} • ${item.event?.venue || 'Venue TBA'}`;
    fragment.querySelector('.student-event-summary').textContent = getStudentStatusCopy(item, state);
    fragment.querySelector('.student-event-date').textContent = eventDate ? formatShortDate(eventDate) : 'TBA';
    fragment.querySelector('.student-event-time').textContent = eventDate ? formatTimeValue(eventDate) : 'TBA';
    fragment.querySelector('.student-event-venue').textContent = item.event?.venue || 'Venue TBA';

    const status = fragment.querySelector('.status-pill');
    status.textContent = state.label;
    status.className = `status-pill ${state.className}`;

    detailLink.className = 'btn btn-outline-primary';
    detailLink.href = `event-detail.html?id=${item.eventId}`;
    detailLink.textContent = 'View Event 👀';

    if (state.action === 'qr') {
      const button = document.createElement('button');
      button.className = 'btn btn-outline-primary';
      button.textContent = 'View QR Code 📱';
      button.addEventListener('click', () => {
        renderQrCode(item.qrCode);
        qrModalTitle.textContent = 'Your Event QR 📱';
        qrEventName.textContent = item.event?.title || 'Event';
        saveQrButton.onclick = downloadQrImage;
        qrModal.show();
      });
      actionArea.append(button, detailLink);

      if (item.status === 'registered' && getEventMillis(item.event) > Date.now()) {
        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn btn-outline-primary';
        cancelButton.textContent = 'Cancel ↩️';
        cancelButton.addEventListener('click', async () => {
          const confirmed = window.confirm(`Cancel your registration for ${item.event?.title || 'this event'}?`);
          if (!confirmed) return;
          await cancelRegistration(item.registrationId, item.eventId);
          showToast('Registration cancelled. Your spot has been released. ↩️', 'info');
        });
        actionArea.appendChild(cancelButton);
      }
    } else if (state.action === 'certificate') {
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.textContent = 'Download 📄';
      button.addEventListener('click', async () => {
        const success = await generateCertificate(
          userProfile.name,
          item.event?.title || 'Event',
          formatDate(item.event?.date),
          auth.currentUser?.uid,
          item.eventId
        );
        if (success) {
          if (window.confetti) {
            window.confetti({
              particleCount: 120,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#232323', '#A8D5C3', '#F59E0B', '#ffffff']
            });
          }
          const stored = getStoredCertificates(auth.currentUser.uid);
          if (!stored.includes(item.registrationId)) {
            stored.push(item.registrationId);
            saveStoredCertificates(auth.currentUser.uid, stored);
          }
          document.getElementById('statCertificates').textContent = stored.length;
          onCertificateSaved?.();
          showToast('Certificate saved! 📄 You earned it.', 'success');
        }
      });
      actionArea.append(button, detailLink);
    } else if (state.action === 'waitlisted') {
      const info = document.createElement('span');
      info.className = 'fw-semibold align-self-center';
      info.textContent = `Position #${item.waitlistPos} in queue`;
      actionArea.append(info, detailLink);
    } else if (state.action === 'attended') {
      const info = document.createElement('span');
      info.className = 'text-muted fw-semibold align-self-center';
      info.textContent = 'Waiting for organizer to complete the event';
      actionArea.append(info, detailLink);
    } else {
      actionArea.append(detailLink);
    }

    list.appendChild(fragment);
  });
}

export async function initStudentDashboard() {
  const { user, profile } = await checkAuth('student');
  const qrModal = new bootstrap.Modal(document.getElementById('qrModal'));
  const tabs = document.querySelectorAll('#studentTabs .btn-pill');
  const signOutButton = document.getElementById('studentSignOutButton');
  let allItems = [];
  let activeTab = 'all';
  let latestRegistrations = [];
  let attendedEventIds = new Set();
  let campusEvents = [];
  let campusEventsById = new Map();
  let latestRank = null;

  document.getElementById('studentGreeting').textContent = `Hey ${profile.name}! 👋`;
  signOutButton?.addEventListener('click', async () => {
    await signOutUser();
  });

  showLoadingSpinner('studentDashboardLoader', 'Loading your events…');

  let refreshTimer = null;
  const renderStudentSurface = () => {
    renderStudentSidePanels(profile, allItems, campusEvents, latestRank);
    renderStudentDashboardItems(
      filterStudentItems(allItems, activeTab),
      profile,
      qrModal,
      renderStudentSurface
    );
  };

  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const registrations = await Promise.all(
        latestRegistrations.map(async (item) => {
          const cachedEvent = campusEventsById.get(item.eventId);
          if (cachedEvent) {
            return {
              ...item,
              event: cachedEvent,
              attended: attendedEventIds.has(item.eventId)
            };
          }

          const eventSnapshot = await getDoc(doc(db, 'events', item.eventId));
          return {
            ...item,
            event: eventSnapshot.exists() ? { id: eventSnapshot.id, ...eventSnapshot.data() } : null,
            attended: attendedEventIds.has(item.eventId)
          };
        })
      );

      allItems = registrations.sort((left, right) => getEventMillis(right.event) - getEventMillis(left.event));

      const attendedCount = allItems.filter((item) => item.attended).length;
      latestRank = await getUserRank(user.uid);
      applyStudentStats(user.uid, allItems, attendedCount, latestRank);
      renderStudentSurface();
      hideLoadingSpinner('studentDashboardLoader', '');
    }, 150);
  };

  onSnapshot(
    query(collection(db, 'events')),
    (snapshot) => {
      campusEvents = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((left, right) => getEventMillis(left) - getEventMillis(right));
      campusEventsById = new Map(campusEvents.map((event) => [event.id, event]));
      scheduleRefresh();
    }
  );

  onSnapshot(
    query(collection(db, 'registrations'), where('userId', '==', user.uid)),
    (snapshot) => {
      latestRegistrations = snapshot.docs.map((item) => ({
        ...item.data(),
        registrationId: item.id
      }));
      scheduleRefresh();
    }
  );

  onSnapshot(
    query(collection(db, 'attendance'), where('userId', '==', user.uid)),
    (snapshot) => {
      attendedEventIds = new Set(snapshot.docs.map((item) => item.data().eventId));
      scheduleRefresh();
    }
  );

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((button) => button.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderStudentSurface();
    });
  });
}

export { formatActivityTime };
