const FIRESTORE_TRANSPORT_STORAGE_KEY = 'eventdesk-force-long-polling';
const FIRESTORE_TRANSPORT_QUERY_PARAM = 'transport';
const FIRESTORE_TRANSPORT_LONG_POLLING = 'long-polling';
const FIRESTORE_TRANSPORT_AUTO = 'auto';
const LOCAL_PREVIEW_HOSTNAME_RE = /^(localhost|127\.0\.0\.1)$/i;

function readTransportParam() {
  try {
    return new URLSearchParams(window.location.search).get(FIRESTORE_TRANSPORT_QUERY_PARAM) || '';
  } catch (_error) {
    return '';
  }
}

function persistTransportPreference(transportParam) {
  try {
    if (transportParam === FIRESTORE_TRANSPORT_LONG_POLLING) {
      window.localStorage.setItem(FIRESTORE_TRANSPORT_STORAGE_KEY, 'true');
      return;
    }

    if (transportParam === FIRESTORE_TRANSPORT_AUTO) {
      window.localStorage.removeItem(FIRESTORE_TRANSPORT_STORAGE_KEY);
    }
  } catch (_error) {
    // Ignore storage failures and fall back to runtime detection.
  }
}

function hasPersistedCompatibilityMode() {
  try {
    return window.localStorage.getItem(FIRESTORE_TRANSPORT_STORAGE_KEY) === 'true';
  } catch (_error) {
    return false;
  }
}

export function isLocalPreviewMode() {
  try {
    return LOCAL_PREVIEW_HOSTNAME_RE.test(window.location.hostname);
  } catch (_error) {
    return false;
  }
}

export function isFirestoreCompatibilityModeActive() {
  const transportParam = readTransportParam();
  persistTransportPreference(transportParam);

  if (transportParam === FIRESTORE_TRANSPORT_LONG_POLLING) {
    return true;
  }

  if (transportParam === FIRESTORE_TRANSPORT_AUTO) {
    return false;
  }

  if (hasPersistedCompatibilityMode()) {
    return true;
  }

  return isLocalPreviewMode();
}

export function getFirestoreInitializationOptions() {
  return isFirestoreCompatibilityModeActive()
    ? {
        experimentalForceLongPolling: true,
        useFetchStreams: false
      }
    : {
        experimentalAutoDetectLongPolling: true,
        useFetchStreams: false
      };
}

export function isRecoverableFirestoreTransportError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code.includes('unavailable')
    || code.includes('deadline-exceeded')
    || code.includes('failed-precondition')
    || code.includes('aborted')
    || code.includes('cancelled')
    || code.includes('network-request-failed')
    || message.includes('offline')
    || message.includes('transport errored')
    || message.includes('webchannel')
    || message.includes('stream')
  );
}

export function buildFirestoreCompatibilityUrl(target = window.location.href) {
  const nextUrl = new URL(target, window.location.origin);
  nextUrl.searchParams.set(FIRESTORE_TRANSPORT_QUERY_PARAM, FIRESTORE_TRANSPORT_LONG_POLLING);
  return nextUrl;
}

export function getFirestoreRecoveryAdvice() {
  if (!isLocalPreviewMode()) {
    return 'Check the Firebase rules, project config, and network connection, then refresh.';
  }

  if (isFirestoreCompatibilityModeActive()) {
    return 'Compatibility mode is already active in this browser. Check the Firebase project config, network connection, and refresh.';
  }

  const nextUrl = buildFirestoreCompatibilityUrl();
  return `Open the compatibility-mode version of this page: ${nextUrl.pathname}${nextUrl.search}`;
}

export function tryRecoverFirestoreTransport(error, surface = 'live feed') {
  if (!isLocalPreviewMode() || isFirestoreCompatibilityModeActive() || !isRecoverableFirestoreTransportError(error)) {
    return false;
  }

  const nextUrl = buildFirestoreCompatibilityUrl();
  console.warn(`Retrying ${surface} with Firestore compatibility mode.`, error);
  window.location.replace(nextUrl.toString());
  return true;
}

export function withFirestoreTransportRecovery(surface, onError) {
  return (error) => {
    if (tryRecoverFirestoreTransport(error, surface)) {
      return;
    }

    onError?.(error);
  };
}
