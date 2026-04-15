import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import { withFirestoreTransportRecovery } from './firestore-transport.js';
import { normalizeExternalOpportunity } from './opportunity-utils.js';

export async function getExternalEventById(eventId) {
  if (!eventId) return null;

  try {
    const snapshot = await getDoc(doc(db, 'externalEvents', eventId));
    if (!snapshot.exists()) {
      return null;
    }

    return normalizeExternalOpportunity({ id: snapshot.id, ...snapshot.data() });
  } catch (error) {
    console.warn('External opportunity detail skipped:', error);
    return null;
  }
}

export async function fetchExternalEventsSnapshot() {
  const snapshot = await getDocs(query(collection(db, 'externalEvents'), where('isActive', '==', true)));
  return snapshot.docs.map((item) => normalizeExternalOpportunity({ id: item.id, ...item.data() }));
}

export async function fetchExternalSyncStatusSnapshot() {
  const snapshot = await getDoc(doc(db, 'externalSyncStatus', 'unstop'));
  return snapshot.exists() ? snapshot.data() : null;
}

export function subscribeToExternalEvents(callback, onError) {
  return onSnapshot(
    query(collection(db, 'externalEvents'), where('isActive', '==', true)),
    (snapshot) => {
      callback(
        snapshot.docs.map((item) => normalizeExternalOpportunity({ id: item.id, ...item.data() }))
      );
    },
    withFirestoreTransportRecovery('external opportunities feed', onError)
  );
}

export function subscribeToExternalSyncStatus(callback, onError) {
  return onSnapshot(
    doc(db, 'externalSyncStatus', 'unstop'),
    (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : null);
    },
    withFirestoreTransportRecovery('external sync status', onError)
  );
}
