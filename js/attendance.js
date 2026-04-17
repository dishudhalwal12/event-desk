import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import {
  checkOnline,
  formatDate,
  parseRegistrationQrPayload,
  showToast
} from './utils.js';

let html5QrCode = null;
let activeScannerEventId = null;
let scanLocked = false;
const SCAN_LOCK_RELEASE_MS = 900;

function getScannerBoxSize(viewfinderWidth, viewfinderHeight) {
  const shortestSide = Math.min(viewfinderWidth, viewfinderHeight);
  const dimension = Math.max(220, Math.min(Math.floor(shortestSide * 0.72), 340));
  return { width: dimension, height: dimension };
}

function getScannerConfig() {
  return {
    fps: 15,
    qrbox: getScannerBoxSize,
    aspectRatio: 1
  };
}

function getQrFormats() {
  const qrFormat = window.Html5QrcodeSupportedFormats?.QR_CODE;
  return qrFormat !== undefined ? [qrFormat] : undefined;
}

function choosePreferredCamera(cameras = []) {
  return cameras.find((camera) => /(back|rear|environment)/i.test(camera.label))
    || cameras.find((camera) => /(wide|ultra|triple)/i.test(camera.label))
    || cameras[0]
    || null;
}

async function getBestCameraSelection() {
  if (typeof window.Html5Qrcode?.getCameras !== 'function') {
    return { facingMode: 'environment' };
  }

  try {
    const cameras = await window.Html5Qrcode.getCameras();
    const preferred = choosePreferredCamera(cameras);
    return preferred?.id || { facingMode: 'environment' };
  } catch (error) {
    console.warn('Camera discovery fallback:', error);
    return { facingMode: 'environment' };
  }
}

async function getAttendanceRecord(registrationId) {
  const attendanceRef = doc(db, 'attendance', registrationId);
  const directSnapshot = await getDoc(attendanceRef);

  if (directSnapshot.exists()) {
    return { ref: attendanceRef, data: directSnapshot.data() };
  }

  const legacySnapshot = await getDocs(
    query(collection(db, 'attendance'), where('registrationId', '==', registrationId))
  );

  if (!legacySnapshot.empty) {
    return { ref: attendanceRef, data: legacySnapshot.docs[0].data() };
  }

  return { ref: attendanceRef, data: null };
}

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
    const parsed = parseRegistrationQrPayload(qrData);
    if (parsed.eventId !== eventId) {
      setScannerResult('error', 'This QR is not for this event ❌');
      return { success: false, reason: 'invalid-event' };
    }

    const [registrationSnapshot, attendanceRecord] = await Promise.all([
      getDoc(doc(db, 'registrations', parsed.regId)),
      getAttendanceRecord(parsed.regId)
    ]);
    const registrationData = registrationSnapshot.exists() ? registrationSnapshot.data() : null;
    const studentName = registrationData?.name || 'Student';

    if (!registrationSnapshot.exists()) {
      setScannerResult('error', 'This QR is not for this event ❌');
      return { success: false, reason: 'missing-registration' };
    }

    if (attendanceRecord.data) {
      const attendanceData = attendanceRecord.data;
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

    await setDoc(attendanceRecord.ref, {
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
    }, SCAN_LOCK_RELEASE_MS);
  }
}

export async function initScanner(elementId, eventId) {
  if (!checkOnline()) return null;
  if (!window.Html5Qrcode) {
    showToast('Scanner library is missing.', 'error');
    return null;
  }

  if (html5QrCode) {
    await stopScanner();
  }

  activeScannerEventId = eventId;
  html5QrCode = new window.Html5Qrcode(
    elementId,
    getQrFormats() ? { formatsToSupport: getQrFormats() } : undefined
  );

  const cameraSelection = await getBestCameraSelection();
  const onScanSuccess = async (decodedText) => {
    await validateAndMarkAttendance(decodedText, activeScannerEventId);
  };

  try {
    await html5QrCode.start(
      cameraSelection,
      getScannerConfig(),
      onScanSuccess,
      () => {}
    );
  } catch (error) {
    if (typeof cameraSelection === 'string') {
      await html5QrCode.start(
        { facingMode: 'environment' },
        getScannerConfig(),
        onScanSuccess,
        () => {}
      );
    } else {
      throw error;
    }
  }

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
