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

function isMobileBrowser() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
}

function getScannerConfig() {
  return {
    fps: 25,
    disableFlip: false,
    qrbox: { width: 250, height: 250 }
  };
}

function getQrFormats() {
  const qrFormat = window.Html5QrcodeSupportedFormats?.QR_CODE;
  return qrFormat !== undefined ? [qrFormat] : undefined;
}

function getScannerConstructorConfig() {
  const config = {
    useBarCodeDetectorIfSupported: true,
    verbose: false
  };
  const formats = getQrFormats();
  if (formats) {
    config.formatsToSupport = formats;
  }
  return config;
}

function scoreCamera(camera) {
  const label = String(camera?.label || '').toLowerCase();
  const mobile = isMobileBrowser();
  let score = 0;

  if (mobile) {
    if (/(back|rear|environment)/i.test(label)) score += 120;
    if (/(wide|ultra|tele)/i.test(label)) score += 25;
    if (/(front|user|facetime)/i.test(label)) score -= 40;
  } else {
    if (/(front|user|facetime|webcam|integrated)/i.test(label)) score += 120;
    if (/(back|rear|environment)/i.test(label)) score += 40;
  }

  if (/default/.test(label)) score += 8;
  if (camera?.id === '0') score += 4;

  return score;
}

async function getAvailableCameras() {
  if (typeof window.Html5Qrcode?.getCameras !== 'function') {
    return [];
  }

  try {
    const cameras = await window.Html5Qrcode.getCameras();
    return [...cameras].sort((left, right) => scoreCamera(right) - scoreCamera(left));
  } catch (error) {
    console.warn('Camera discovery fallback:', error);
    return [];
  }
}

function getCameraCandidates(cameras = []) {
  const candidates = cameras
    .map((camera) => camera?.id)
    .filter(Boolean);

  if (isMobileBrowser()) {
    candidates.push(
      { facingMode: { ideal: 'environment' } },
      { facingMode: 'environment' },
      { facingMode: { ideal: 'user' } }
    );
  } else {
    candidates.push(
      { facingMode: { ideal: 'user' } },
      { facingMode: 'user' },
      { facingMode: { ideal: 'environment' } }
    );
  }

  return candidates;
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

async function startScannerWithFallbacks(onScanSuccess) {
  const cameras = await getAvailableCameras();
  const candidates = getCameraCandidates(cameras);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      await html5QrCode.start(
        candidate,
        getScannerConfig(),
        onScanSuccess,
        () => {}
      );
      return candidate;
    } catch (error) {
      lastError = error;
      console.warn('Scanner candidate failed:', candidate, error);
    }
  }

  throw lastError || new Error('No camera could be started for scanning.');
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

export async function handleQrUpload(file, eventId) {
  if (!html5QrCode) {
    showToast('Scanner must be active to upload images.', 'warning');
    return;
  }

  const status = document.getElementById('qrUploadStatus');
  if (status) {
    status.className = 'mt-2 small text-center text-primary';
    status.textContent = 'Processing image... ⏳';
  }

  try {
    const decodedText = await html5QrCode.scanFile(file, true);
    if (status) {
      status.className = 'mt-2 small text-center text-success';
      status.textContent = 'QR decoded successfully! ✅';
    }
    await validateAndMarkAttendance(decodedText, eventId);
  } catch (error) {
    console.error('QR Upload error:', error);
    if (status) {
      status.className = 'mt-2 small text-center text-danger';
      status.textContent = 'Could not find a QR code in this image. ❌';
    }
    showToast('Could not find a QR code in this image.', 'error');
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
  html5QrCode = new window.Html5Qrcode(elementId, getScannerConstructorConfig());
  setScannerResult('warning', 'Starting camera…', 'Allow webcam access if your browser asks. The QR can sit anywhere in the frame.');

  const onScanSuccess = async (decodedText) => {
    await validateAndMarkAttendance(decodedText, activeScannerEventId);
  };

  try {
    await startScannerWithFallbacks(onScanSuccess);
    setScannerResult('', 'Ready to scan', 'The QR can be off-center. Laptop webcams and phone cameras are both supported.');
  } catch (error) {
    console.error(error);
    setScannerResult('error', 'Could not start the camera ❌', 'Allow webcam access and reopen the scanner, or try another available camera.');
    showToast('Could not start the QR scanner on this device.', 'error');
    await stopScanner();
    return null;
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
