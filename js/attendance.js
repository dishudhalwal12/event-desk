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

// ─── UI Helper ───────────────────────────────────────────────────────────────

function setScannerResult(type, title, subtitle = '') {
  const card = document.getElementById('scannerResultCard');
  if (!card) return;
  card.className = `scanner-result-card ${type}`;
  card.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
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
      parsed = parseRegistrationQrPayload(String(qrData || '').trim());
    } catch (parseErr) {
      setScannerResult('error', 'Invalid Token ❌', 'This is not a valid EventDesk attendance token. Copy the full token from the student\'s QR screen.');
      return { success: false, reason: 'invalid-format' };
    }

    if (parsed.eventId !== eventId) {
      setScannerResult('error', 'Wrong event ❌', `Token belongs to event ID: ${parsed.eventId}. You are scanning for: ${eventId}.`);
      return { success: false, reason: 'invalid-event' };
    }

    const [registrationSnap, attendanceRecord] = await Promise.all([
      getDoc(doc(db, 'registrations', parsed.regId)),
      getAttendanceRecord(parsed.regId)
    ]);

    if (!registrationSnap.exists()) {
      setScannerResult('error', 'Registration not found ❌', 'No matching registration found in the database.');
      return { success: false, reason: 'missing-registration' };
    }

    const reg = registrationSnap.data();
    const studentName = reg?.name || 'Student';

    if (attendanceRecord.data) {
      setScannerResult('warning', `Already checked in 🔁`,
        `${studentName} was already marked present at ${formatDate(attendanceRecord.data.scannedAt)}`);
      return { success: false, reason: 'duplicate' };
    }

    if (reg?.eventId !== eventId || reg?.userId !== parsed.userId) {
      setScannerResult('error', 'QR mismatch ❌', 'Registration data does not match this event.');
      return { success: false, reason: 'mismatched-registration' };
    }

    if (reg?.status !== 'registered') {
      setScannerResult('warning', `${studentName} not confirmed ⏳`,
        `Status is "${reg?.status}". Only confirmed registrations can be marked present.`);
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
    showToast(`✅ ${studentName} marked present!`, 'success');
    return { success: true, studentName };

  } catch (error) {
    console.error('validateAndMarkAttendance error:', error);
    setScannerResult('error', 'Error ❌', error?.message || 'An unexpected error occurred.');
    return { success: false, reason: 'unknown-error' };
  } finally {
    window.setTimeout(() => { scanLocked = false; }, SCAN_LOCK_RELEASE_MS);
  }
}

// ─── QR Image Upload ─────────────────────────────────────────────────────────
// Uses jsQR (canvas-based) — zero DOM dependency, works even if camera is blocked

function decodeQrFromImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // jsQR: pure JS QR decoder, no DOM conflicts whatsoever
        if (typeof window.jsQR !== 'function') {
          reject(new Error('jsQR library not loaded'));
          return;
        }

        const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (result && result.data) {
          resolve(result.data);
        } else {
          reject(new Error('No QR code found in image'));
        }
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image file'));
    };

    img.src = objectUrl;
  });
}

export async function handleQrUpload(file, eventId) {
  const statusEl = document.getElementById('qrUploadStatus');

  const setStatus = (cls, text) => {
    if (statusEl) {
      statusEl.className = `mt-2 small text-center ${cls}`;
      statusEl.textContent = text;
    }
  };

  if (!file) { setStatus('text-warning', '⚠️ No file selected.'); return; }
  if (!eventId) { setStatus('text-warning', '⚠️ No event selected — open scanner from an event card.'); return; }

  setStatus('text-primary', '⏳ Reading QR code from image...');

  try {
    const qrData = await decodeQrFromImage(file);
    setStatus('text-success', `✅ QR decoded! Marking attendance...`);
    const result = await validateAndMarkAttendance(qrData, eventId);
    if (!result.success) {
      // setScannerResult already shows the error in the result card
      setStatus('text-danger', '❌ Could not mark attendance. See result card above.');
    }
  } catch (err) {
    console.warn('QR image decode failed:', err?.message);
    setStatus('text-danger', '❌ No QR code found in this image. Try saving a cleaner screenshot.');
    showToast('No QR code detected. Try a clearer screenshot of the student\'s QR.', 'warning');
  }
}

// ─── Camera Scanner ──────────────────────────────────────────────────────────

function isMobileBrowser() {
  return /android|iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
}

function getScannerConfig() {
  return { fps: 10, qrbox: { width: 250, height: 250 }, disableFlip: false };
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
    // Permission denied — silently skip camera
    console.warn('Camera not available:', err?.message || err);
    return [];
  }
}

async function startScannerWithFallbacks(onScanSuccess) {
  const cameras = await getAvailableCameras();

  // Only try real camera device IDs — never facingMode strings/objects
  // facingMode causes "should be string or object with exact key" errors in html5-qrcode
  const candidates = cameras.map((c) => c.id).filter(Boolean);

  if (candidates.length === 0) {
    throw new Error('No cameras found or camera access was denied.');
  }

  let lastError = null;
  for (const cameraId of candidates) {
    if (!html5QrCode) break;
    try {
      await html5QrCode.start(cameraId, getScannerConfig(), onScanSuccess, () => {});
      return cameraId;
    } catch (err) {
      lastError = err;
      console.warn('Camera ID failed:', cameraId, err?.message || err);
    }
  }

  throw lastError || new Error('Could not start any camera.');
}

export async function initScanner(elementId, eventId) {
  if (!checkOnline()) return null;
  if (!window.Html5Qrcode) {
    showToast('QR scanner library is missing.', 'error');
    return null;
  }

  if (html5QrCode) await stopScanner();

  activeScannerEventId = eventId;
  html5QrCode = new window.Html5Qrcode(elementId, getScannerConstructorConfig());
  setScannerResult('warning', 'Starting camera…',
    'Click Allow when the browser asks for camera access. Or use the upload / token options below.');

  const onScanSuccess = async (decodedText) => {
    await validateAndMarkAttendance(decodedText, activeScannerEventId);
  };

  try {
    await startScannerWithFallbacks(onScanSuccess);
    setScannerResult('', 'Camera ready ✅', 'Point it at the student\'s QR code. Or use the token/upload options below.');
  } catch (err) {
    console.warn('Camera unavailable:', err?.message);
    // Don't show an error toast — the upload + token options still work fine
    setScannerResult('warning', 'Camera unavailable 📷',
      'Camera access was blocked or no camera found. Use the "Upload QR Image" or "Paste Token" options below — they work without a camera.');
    await stopScanner();
    return null;
  }

  return html5QrCode;
}

export async function stopScanner() {
  if (!html5QrCode) return;
  const instance = html5QrCode;
  html5QrCode = null;

  try {
    if (instance.isScanning) await instance.stop();
    await instance.clear();
  } catch (err) {
    // Silently ignore — scanner was already stopped
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
