import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBCnaC7Q8EcASXbd3LYb5ycE7twOGVJeOI',
  authDomain: 'krishna-e9c59.firebaseapp.com',
  projectId: 'krishna-e9c59',
  storageBucket: 'krishna-e9c59.firebasestorage.app',
  messagingSenderId: '1048468387337',
  appId: '1:1048468387337:web:ab73eb62ef72118bb02ad8',
  measurementId: 'G-876D604WWH'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn('Auth persistence fallback:', error);
});

export { app, auth, db, storage, firebaseConfig };
