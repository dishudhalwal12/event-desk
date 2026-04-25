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

// ─── Helpers ────────────────────────────────────────────────────────────────

function isMobileBrowser() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
}

function getScannerConfig() {
  return {
    fps: 15,
    disableFlip: false,
    qrbox: { width: 250, height: 250 }
  };
}

function getScannerConstructorConfig() {
  const config = { useBarCodeDetectorIfSupported: true, verbose: false };
  const qrFormat = window.Html5QrcodeSupportedFormats?.QR_CODE;
  if (qrFormat !== undefined) config.formatsToSupport = [qrFormat];
  return config;
}

function scoreCamera(camera) {
  const label = String(camera?.label || '').toLowerCase();
  let score = 0;
  if (isMobileBrowser()) {
    if (/(back|rear|environment)/i.test(label)) score += 120;
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
  if (typeof window.Html5Qrcode?.getCameras !== 'function') return [];
  try {
    const cameras = await window.Html5Qrcode.getCameras();
    return [...cameras].sort((a, b) => scoreCamera(b) - scoreCamera(a));
  } catch (err) {
    console.warn('Camera discovery failed:', err?.message || err);
    return [];
  }
}

function getCameraCandidates(cameras = []) {
  const ids = cameras.map((c) => c?.id).filter(Boolean);
  // Use plain string facing mode — object form causes "facingMode should be string" error
  return isMobileBrowser()
    ? [...ids, 'environment', 'user']
    : [...ids, 'user', 'environment'];
}

// ─── Firestore ───────────────────────────────────────────────────────────────

async function getAttendanceRecord(registrationId) {
  const attendanceRef = doc(db, 'attendance', registrationId);
  const directSnap = await getDoc(attendanceRef);
  if (directSnap.exists()) return { ref: attendanceRef, data: directSnap.data() };

  const legacySnap = await getDocs(
    query(collection(db, 'attendance'), where('registrationId', '==', registrationId))
  );
  return {
    ref: attendanceRef,
    data: legacySnap.empty ? null : legacySnap.docs[0].data()
  };
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function setScannerResult(type, title, subtitle = '') {
  const card = document.getElementById('scannerResultCard');
  if (!card) return;
  card.className = `scanner-result-card ${type}`;
  card.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
}

// ─── Core: Mark Attendance ───────────────────────────────────────────────────

export async function validateAndMarkAttendance(qrData, eventId) {
  if (!checkOnline()) {
    setScannerResult('error', 'No internet connection ❌', 'Connect to the internet and try again.');
    return { success: false, reason: 'offline' };
  }
  if (scanLocked) return { success: false, reason: 'locked' };
  scanLocked = true;

  try {
    let parsed;
    try {
      parsed = parseRegistrationQrPayload(qrData);
    } catch (parseErr) {
      setScannerResult('error', 'Invalid QR / Token ❌', 'This does not look like a valid EventDesk token.');
      return { success: false, reason: 'invalid-format' };
    }

    if (parsed.eventId !== eventId) {
      setScannerResult('error', 'Wrong event ❌', `This QR is for a different event (${parsed.eventId}).`);
      return { success: false, reason: 'invalid-event' };
    }

    const [registrationSnap, attendanceRecord] = await Promise.all([
      getDoc(doc(db, 'registrations', parsed.regId)),
      getAttendanceRecord(parsed.regId)
    ]);

    if (!registrationSnap.exists()) {
      setScannerResult('error', 'Registration not found ❌', 'No matching registration in the database.');
      return { success: false, reason: 'missing-registration' };
    }

    const reg = registrationSnap.data();
    const studentName = reg?.name || 'Student';

    if (attendanceRecord.data) {
      setScannerResult('warning', `Already checked in 🔁 ${studentName}`,
        `Checked in at ${formatDate(attendanceRecord.data.scannedAt)}`);
      return { success: false, reason: 'duplicate' };
    }

    if (reg?.eventId !== eventId || reg?.userId !== parsed.userId) {
      setScannerResult('error', 'QR mismatch ❌', 'Registration data does not match this event.');
      return { success: false, reason: 'mismatched-registration' };
    }

    if (reg?.status !== 'registered') {
      setScannerResult('warning', `${studentName} not confirmed ⏳`,
        'Only confirmed registrations can be marked present.');
      return { success: false, reason: 'not-confirmed' };
    }

    await setDoc(attendanceRecord.ref, {
      registrationId: parsed.regId,
      eventId,
      userId: parsed.userId,
      studentName,
      scannedAt: serverTimestamp()
    });

    const time = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    setScannerResult('success', `Attended ✅ ${studentName}`, `Checked in at ${time}`);
    showToast(`✅ ${studentName} is marked present!`, 'success');
    return { success: true, studentName };

  } catch (error) {
    console.error('validateAndMarkAttendance error:', error);
    setScannerResult('error', 'Something went wrong ❌', error?.message || 'Please try again.');
    return { success: false, reason: 'unknown-error' };
  } finally {
    window.setTimeout(() => { scanLocked = false; }, SCAN_LOCK_RELEASE_MS);
  }
}

// ─── QR Image Upload ─────────────────────────────────────────────────────────
// Uses a HIDDEN div so it never conflicts with the live camera scanner (#qr-reader)

export async function handleQrUpload(file, eventId) {
  const status = document.getElementById('qrUploadStatus');

  const setStatus = (cls, text) => {
    if (status) {
      status.className = `mt-2 small text-center ${cls}`;
      status.textContent = text;
    }
  };

  if (!file) { setStatus('text-warning', 'No file selected.'); return; }
  if (!eventId) { setStatus('text-warning', 'No event selected.'); return; }
  if (!window.Html5Qrcode) { setStatus('text-danger', 'Scanner library not loaded.'); return; }

  setStatus('text-primary', 'Scanning image... ⏳');

  // Create a hidden scratch div — keeps it 100% independent of the camera scanner
  const scratchId = 'qr-upload-scratch-' + Date.now();
  const scratchDiv = document.createElement('div');
  scratchDiv.id = scratchId;
  scratchDiv.style.display = 'none';
  document.body.appendChild(scratchDiv);

  const scanner = new window.Html5Qrcode(scratchId, { verbose: false });

  try {
    const decodedText = await scanner.scanFile(file, /* showImage= */ false);
    setStatus('text-success', 'QR detected! Marking attendance... ✅');
    await validateAndMarkAttendance(decodedText, eventId);
  } catch (err) {
    console.warn('QR image scan failed:', err?.message || err);
    setStatus('text-danger', '❌ No QR found. Try a clearer screenshot or use the token instead.');
    showToast('Could not read QR from this image. Try pasting the token directly.', 'warning');
  } finally {
    try { await scanner.clear(); } catch (_) {}
    scratchDiv.remove();
  }
}

// ─── Camera Scanner ──────────────────────────────────────────────────────────

async function startScannerWithFallbacks(onScanSuccess) {
  const cameras = await getAvailableCameras();
  const candidates = getCameraCandidates(cameras);
  let lastError = null;

  for (const candidate of candidates) {
    if (!html5QrCode) break; // aborted
    try {
      await html5QrCode.start(candidate, getScannerConfig(), onScanSuccess, () => {});
      return candidate; // success
    } catch (err) {
      lastError = err;
      console.warn('Camera candidate failed:', candidate, err?.message || err);
      // Wait briefly if transitioning
      if (String(err).toLowerCase().includes('transition')) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  throw lastError || new Error('No camera could be started.');
}

export async function initScanner(elementId, eventId) {
  if (!checkOnline()) return null;
  if (!window.Html5Qrcode) {
    showToast('Scanner library is missing.', 'error');
    return null;
  }

  // Clean up any leftover instance
  if (html5QrCode) await stopScanner();

  activeScannerEventId = eventId;
  html5QrCode = new window.Html5Qrcode(elementId, getScannerConstructorConfig());
  setScannerResult('warning', 'Starting camera…',
    'Allow webcam access when the browser asks. The QR can sit anywhere in the frame.');

  const onScanSuccess = async (decodedText) => {
    await validateAndMarkAttendance(decodedText, activeScannerEventId);
  };

  try {
    await startScannerWithFallbacks(onScanSuccess);
    setScannerResult('', 'Ready to scan ✅',
      'Point the camera at the student\'s QR code. Or use the token / upload options below.');
  } catch (err) {
    console.error('initScanner failed:', err);
    setScannerResult('error', 'Camera unavailable ❌',
      'Allow webcam access and reopen, or use the "Upload QR Image" / "Paste Token" options below.');
    showToast('Camera could not start. Use QR upload or token instead.', 'warning');
    await stopScanner();
    return null;
  }

  return html5QrCode;
}

export async function stopScanner() {
  if (!html5QrCode) return;
  const instance = html5QrCode;
  html5QrCode = null; // Prevent race: unset before async ops

  try {
    if (instance.isScanning) await instance.stop();
    await instance.clear();
  } catch (err) {
    console.warn('Scanner cleanup note:', err?.message || err);
  } finally {
    activeScannerEventId = null;
    scanLocked = false;
  }
}

export async function hasStudentAttended(userId, eventId) {
  const snap = await getDocs(
    query(collection(db, 'attendance'),
      where('userId', '==', userId),
      where('eventId', '==', eventId))
  );
  return !snap.empty;
}
