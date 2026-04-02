import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBCnaC7Q8EcASXbd3LYb5ycE7twOGVJeOI',
  authDomain: 'krishna-e9c59.firebaseapp.com',
  projectId: 'krishna-e9c59',
  messagingSenderId: '1048468387337',
  appId: '1:1048468387337:web:ab73eb62ef72118bb02ad8',
  measurementId: 'G-876D604WWH'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

function shouldForceLongPolling() {
  try {
    const params = new URLSearchParams(window.location.search);
    const transportParam = params.get('transport');
    if (transportParam === 'long-polling') {
      window.localStorage.setItem('eventdesk-force-long-polling', 'true');
      return true;
    }

    if (transportParam === 'auto') {
      window.localStorage.removeItem('eventdesk-force-long-polling');
      return false;
    }

    if (window.localStorage.getItem('eventdesk-force-long-polling') === 'true') {
      return true;
    }

    const isLocalPreview = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const isWindowsClient = /windows/i.test(navigator.userAgent);
    return isLocalPreview && isWindowsClient;
  } catch (_error) {
    return false;
  }
}

const useForcedLongPolling = shouldForceLongPolling();
const db = initializeFirestore(app, useForcedLongPolling
  ? {
      experimentalForceLongPolling: true,
      useFetchStreams: false
    }
  : {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });

if (useForcedLongPolling) {
  console.info('EventDesk enabled Firestore compatibility mode (long polling) for this browser.');
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn('Auth persistence fallback:', error);
});

export { app, auth, db, firebaseConfig };
