import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import { checkOnline, formatDate, showToast } from './utils.js';

let html5QrCode = null;
let activeScannerEventId = null;
let scanLocked = false;

function setScannerResult(type, title, subtitle = '') {
  const card = document.getElementById('scannerResultCard');
  if (!card) return;
  card.className = `scanner-result-card ${type}`;
  card.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
}

export async function validateAndMarkAttendance(qrData, eventId) {
  if (!checkOnline()) return { success: false };
  if (scanLocked) return { success: false };
  scanLocked = true;

  try {
    const parsed = JSON.parse(qrData);
    if (parsed.eventId !== eventId) {
      setScannerResult('error', 'This QR is not for this event ❌');
      return { success: false, reason: 'invalid-event' };
    }

    const duplicateQuery = query(
      collection(db, 'attendance'),
      where('registrationId', '==', parsed.regId)
    );
    const existingAttendance = await getDocs(duplicateQuery);

    const registrationSnapshot = await getDoc(doc(db, 'registrations', parsed.regId));
    const registrationData = registrationSnapshot.exists() ? registrationSnapshot.data() : null;
    const studentName = registrationData?.name || 'Student';

    if (!registrationSnapshot.exists()) {
      setScannerResult('error', 'This QR is not for this event ❌');
      return { success: false, reason: 'missing-registration' };
    }

    if (!existingAttendance.empty) {
      const attendanceData = existingAttendance.docs[0].data();
      setScannerResult(
        'warning',
        `Already marked attended 🔁 ${studentName} checked in at ${formatDate(attendanceData.scannedAt)}`
      );
      return { success: false, reason: 'duplicate' };
    }

    if (registrationData?.eventId !== eventId || registrationData?.userId !== parsed.userId) {
      setScannerResult('error', 'This QR is not valid for this event ❌');
      return { success: false, reason: 'mismatched-registration' };
    }

    if (registrationData?.status !== 'registered') {
      setScannerResult('warning', `${studentName} is not confirmed for attendance yet ⏳`, 'Only confirmed registrations can be scanned.');
      return { success: false, reason: 'not-confirmed' };
    }

    await addDoc(collection(db, 'attendance'), {
      registrationId: parsed.regId,
      eventId,
      userId: parsed.userId,
      studentName,
      scannedAt: serverTimestamp()
    });

    setScannerResult('success', `Attended ✅ ${studentName}`, `Scanned at ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`);
    showToast(`Attended ✅ ${studentName} is all set!`, 'success');
    return { success: true, studentName };
  } catch (error) {
    console.error(error);
    setScannerResult('error', 'This QR is not for this event ❌');
    return { success: false, reason: 'parse-error' };
  } finally {
    window.setTimeout(() => {
      scanLocked = false;
    }, 1500);
  }
}

export async function initScanner(elementId, eventId) {
  if (!checkOnline()) return null;
  if (!window.Html5Qrcode) {
    showToast('Scanner library is missing.', 'error');
    return null;
  }

  activeScannerEventId = eventId;
  html5QrCode = new window.Html5Qrcode(elementId);
  await html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 300, height: 300 } },
    async (decodedText) => {
      await validateAndMarkAttendance(decodedText, activeScannerEventId);
    },
    () => {}
  );
  return html5QrCode;
}

export async function stopScanner() {
  if (!html5QrCode) return;
  try {
    await html5QrCode.stop();
    await html5QrCode.clear();
  } catch (error) {
    console.warn('Scanner stop skipped:', error);
  } finally {
    html5QrCode = null;
    activeScannerEventId = null;
    scanLocked = false;
  }
}

export async function hasStudentAttended(userId, eventId) {
  const attendanceQuery = query(
    collection(db, 'attendance'),
    where('userId', '==', userId),
    where('eventId', '==', eventId)
  );
  const snapshot = await getDocs(attendanceQuery);
  return !snapshot.empty;
}
