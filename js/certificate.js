import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { hasStudentAttended } from './attendance.js';
import { formatDate, formatShortDate, showToast, slugify, toDateValue } from './utils.js';

const CERTIFICATE_COLLECTION = 'certificates';
const EVENTDESK_LOGO_URL = new URL('../assets/images/favicon.svg', import.meta.url).href;
const CERTIFICATE_RENDER_WIDTH = 1400;
const CERTIFICATE_RENDER_HEIGHT = 990;
const CERTIFICATE_RENDER_SCALE = 2;
const CERTIFICATE_TEMPLATE_VERSION = 3;

function getCertificateRenderRoot() {
  let root = document.getElementById('eventdeskCertificateRenderRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'eventdeskCertificateRenderRoot';
    root.style.position = 'fixed';
    root.style.left = '-10000px';
    root.style.top = '0';
    root.style.width = `${CERTIFICATE_RENDER_WIDTH}px`;
    root.style.pointerEvents = 'none';
    root.style.zIndex = '-1';
    root.style.opacity = '1';
    document.body.appendChild(root);
  }
  return root;
}

function rankToLabel(rank) {
  const normalized = String(rank || '').trim().toLowerCase();
  if (normalized === 'first') return 'First Place';
  if (normalized === 'second') return 'Second Place';
  if (normalized === 'third') return 'Third Place';
  return 'Winner';
}

function certificateTypeLabel(type) {
  return type === 'winner' ? 'Winner Certificate' : 'Participation Certificate';
}

function certificateDocId(eventId, registrationId, type) {
  return `${type === 'winner' ? 'win' : 'part'}_${eventId}_${registrationId}`;
}

function normalizeRecord(item) {
  return {
    id: item.id,
    ...item.data(),
    awardRankLabel: rankToLabel(item.data().awardRank),
    typeLabel: certificateTypeLabel(item.data().certificateType)
  };
}

function sortCertificateRecords(records = []) {
  return [...records].sort((left, right) => {
    const leftWeight = left.certificateType === 'winner' ? 0 : 1;
    const rightWeight = right.certificateType === 'winner' ? 0 : 1;
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    const leftTime = left.issuedAt?.toMillis ? left.issuedAt.toMillis() : new Date(left.issuedAt || 0).getTime();
    const rightTime = right.issuedAt?.toMillis ? right.issuedAt.toMillis() : new Date(right.issuedAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function buildCertificateRecord({
  event,
  registration,
  certificateType,
  awardRank = null,
  signerName,
  signerTitle,
  coSignerName,
  coSignerTitle,
  issuedBy
}) {
  const eventId = event?.id || event?.eventId || registration?.eventId;
  const registrationId = registration?.registrationId || registration?.id;
  const eventDate = toDateValue(event?.date);
  const venue = String(event?.venue || '').trim();
  const location = String(event?.location || '').trim();
  const studentName = String(registration?.name || registration?.studentName || 'Student').trim();
  const phone = String(registration?.phone || '').trim();

  return {
    id: certificateDocId(eventId, registrationId, certificateType),
    certificateId: certificateDocId(eventId, registrationId, certificateType),
    eventId,
    registrationId,
    userId: registration?.userId || null,
    studentName,
    phone,
    teamName: registration?.teamName || null,
    participantCount: Number(registration?.participantCount) || 1,
    certificateType,
    awardRank: certificateType === 'winner' ? awardRank : null,
    signerName: String(signerName || '').trim(),
    signerTitle: String(signerTitle || '').trim(),
    coSignerName: String(coSignerName || '').trim(),
    coSignerTitle: String(coSignerTitle || '').trim(),
    issuedBy: issuedBy || auth.currentUser?.uid || null,
    status: 'issued',
    sourceType: 'campus',
    templateVersion: CERTIFICATE_TEMPLATE_VERSION,
    eventTitleSnapshot: String(event?.title || 'Campus Event').trim(),
    eventDateSnapshot: eventDate ? eventDate.toISOString() : null,
    venueSnapshot: venue,
    locationSnapshot: location,
    posterUrlSnapshot: String(event?.posterUrl || '').trim(),
    categorySnapshot: String(event?.category || '').trim(),
    eventLogoAlt: String(event?.title || 'Event poster').trim(),
    updatedAt: serverTimestamp(),
    issuedAt: serverTimestamp()
  };
}

function getCertificateData(record) {
  const eventDate = toDateValue(record.eventDateSnapshot) || toDateValue(record.eventDate);
  const venueParts = [record.venueSnapshot, record.locationSnapshot].filter(Boolean);
  const venueLine = venueParts.join(', ') || 'Campus Venue';
  const issueDate = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
  const headline = record.certificateType === 'winner'
    ? rankToLabel(record.awardRank)
    : 'Certificate of Participation';
  const eyebrow = record.certificateType === 'winner'
    ? 'EventDesk Excellence Series'
    : 'EventDesk Participation Ledger';
  const typeLine = record.certificateType === 'winner'
    ? 'Certificate of achievement'
    : 'Certificate of participation';
  const body = record.certificateType === 'winner'
    ? `This certificate proudly recognizes ${record.studentName} for securing ${rankToLabel(record.awardRank)} in ${record.eventTitleSnapshot}, hosted at ${venueLine}${eventDate ? ` on ${formatShortDate(eventDate)}` : ''}.`
    : `This is to certify that ${record.studentName} actively participated in ${record.eventTitleSnapshot}, held at ${venueLine}${eventDate ? ` on ${formatShortDate(eventDate)}` : ''}.`;

  return {
    ...record,
    eventDate,
    headline,
    eyebrow,
    typeLine,
    body,
    issueDate,
    venueLine,
    awardRankLabel: rankToLabel(record.awardRank),
    typeLabel: certificateTypeLabel(record.certificateType)
  };
}

function createCertificateNode(record) {
  const data = getCertificateData(record);
  const accentColor = data.certificateType === 'winner' ? '#c58a2d' : '#2a8f67';
  const leftSignatureBlock = `
    <div style="display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:0;">
      <div style="height:54px; display:flex; align-items:flex-end;">
        <span style="font-family:'Parisienne', cursive; font-size:48px; line-height:1; color:#18233b;">${data.signerName || 'Authorized Signatory'}</span>
      </div>
      <div style="width:280px; max-width:100%; height:1.5px; background:#18233b;"></div>
      <div style="font-size:15px; color:#475569; font-weight:600;">${data.signerTitle || 'Faculty / Delegate Signature'}</div>
    </div>
  `;
  const rightSignatureBlock = data.coSignerName || data.coSignerTitle
    ? `
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; min-width:0;">
        <div style="height:54px; display:flex; align-items:flex-end; justify-content:flex-end;">
          <span style="font-family:'Parisienne', cursive; font-size:48px; line-height:1; color:#18233b;">${data.coSignerName || 'Second Signatory'}</span>
        </div>
        <div style="width:280px; max-width:100%; height:1.5px; background:#18233b;"></div>
        <div style="font-size:15px; color:#475569; font-weight:600; text-align:right;">${data.coSignerTitle || 'Co-signatory'}</div>
      </div>
    `
    : `
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; min-width:0;">
        <div style="font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8; font-weight:700;">Issued on</div>
        <div style="font-size:30px; color:#18233b; font-weight:700;">${data.issueDate}</div>
        <div style="font-size:15px; color:#64748b; text-align:right;">${data.eventDate ? `Event date: ${formatDate(data.eventDate)}` : `Venue: ${data.venueLine}`}</div>
      </div>
    `;
  const wrapper = document.createElement('section');
  wrapper.style.width = `${CERTIFICATE_RENDER_WIDTH}px`;
  wrapper.style.height = `${CERTIFICATE_RENDER_HEIGHT}px`;
  wrapper.style.position = 'relative';
  wrapper.style.overflow = 'hidden';
  wrapper.style.background = 'linear-gradient(135deg, #fffbf1 0%, #fffdf8 56%, #f7f0df 100%)';
  wrapper.style.border = '16px solid #18233b';
  wrapper.style.borderRadius = '30px';
  wrapper.style.boxShadow = '0 30px 80px rgba(15, 23, 42, 0.18)';
  wrapper.style.padding = '40px 48px';
  wrapper.style.fontFamily = "'Poppins', sans-serif";
  wrapper.innerHTML = `
    <div style="position:absolute; inset:18px; border:2px solid rgba(197, 138, 45, 0.28); border-radius:22px;"></div>
    <div style="position:absolute; inset:34px; border:1px solid rgba(197, 138, 45, 0.16); border-radius:18px;"></div>
    <div style="position:absolute; width:360px; height:360px; border-radius:999px; background:rgba(197, 138, 45, 0.08); top:-170px; right:-120px;"></div>
    <div style="position:absolute; width:280px; height:280px; border-radius:999px; background:rgba(24, 35, 59, 0.05); bottom:-120px; left:-90px;"></div>
    <div style="position:absolute; left:54px; top:160px; width:110px; height:420px; border-radius:26px; background:linear-gradient(180deg, rgba(24,35,59,0.98) 0%, rgba(42,56,94,0.96) 100%); box-shadow:0 20px 40px rgba(15, 23, 42, 0.16); overflow:hidden;">
      <div style="position:absolute; inset:0; background:
        radial-gradient(circle at 28px 34px, rgba(255,255,255,0.12) 0 9px, transparent 10px),
        radial-gradient(circle at 74px 72px, rgba(248,181,0,0.18) 0 15px, transparent 16px),
        radial-gradient(circle at 48px 146px, rgba(255,255,255,0.08) 0 12px, transparent 13px),
        radial-gradient(circle at 72px 238px, rgba(248,181,0,0.14) 0 17px, transparent 18px),
        linear-gradient(135deg, transparent 0 42%, rgba(255,255,255,0.16) 42% 46%, transparent 46% 100%),
        linear-gradient(90deg, rgba(255,255,255,0.08) 0 3px, transparent 3px 100%);
      "></div>
    </div>
    <div style="position:relative; z-index:1; height:100%; display:flex; flex-direction:column;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:28px; padding-left:150px;">
        <div style="display:flex; align-items:center; gap:20px;">
          <div style="width:94px; height:94px; border-radius:28px; background:#ffffff; border:1px solid rgba(24, 35, 59, 0.1); display:flex; align-items:center; justify-content:center; box-shadow:0 14px 30px rgba(15, 23, 42, 0.1); overflow:hidden;">
            <img src="${EVENTDESK_LOGO_URL}" alt="EventDesk logo" style="width:66px; height:66px; object-fit:contain;">
          </div>
          <div>
            <div style="font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:${accentColor}; font-weight:700;">${data.eyebrow}</div>
            <div style="font-size:38px; color:#18233b; font-weight:800; margin-top:8px; letter-spacing:0.01em;">EventDesk</div>
            <div style="font-size:15px; color:#64748b; margin-top:6px;">Smart campus event and opportunity desk</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
          <div style="font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:#64748b; font-weight:700;">${data.typeLabel}</div>
          <div style="width:110px; height:110px; border-radius:30px; overflow:hidden; background:linear-gradient(135deg, #f3f4f6, #e5e7eb); border:1px solid rgba(24, 35, 59, 0.12); box-shadow:0 12px 28px rgba(15, 23, 42, 0.08);">
            ${data.posterUrlSnapshot ? `<img src="${data.posterUrlSnapshot}" alt="${data.eventLogoAlt}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:18px; color:#0f172a; font-weight:700; text-align:center; padding:10px;">${data.eventTitleSnapshot}</div>`}
          </div>
        </div>
      </div>

      <div style="margin-top:52px; text-align:center; padding-left:150px;">
        <div style="font-family:'Cormorant Garamond', serif; font-size:68px; font-weight:700; color:#18233b; letter-spacing:0.08em; text-transform:uppercase; margin-top:10px;">
          CERTIFICATE
        </div>
        <div style="font-size:18px; color:${accentColor}; margin-top:6px; letter-spacing:0.22em; text-transform:uppercase; font-weight:700;">${data.typeLine}</div>
      </div>

      <div style="margin-top:34px; text-align:center; padding-left:150px;">
        <div style="font-size:19px; color:#64748b; letter-spacing:0.04em;">This certificate is proudly presented to</div>
        <div style="font-family:'Parisienne', cursive; font-size:96px; line-height:1.12; color:#18233b; margin-top:16px; padding:0 24px;">${data.studentName}</div>
      </div>

      <div style="max-width:980px; margin:28px auto 0; text-align:center; font-size:28px; line-height:1.66; color:#334155; font-family:'Cormorant Garamond', serif; padding-left:150px;">
        ${data.body}
      </div>

      <div style="margin-top:auto; padding-top:36px; padding-left:150px;">
        <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:end; gap:28px;">
          ${leftSignatureBlock}
          <div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:8px; padding-bottom:4px;">
            <div style="font-size:12px; letter-spacing:0.16em; text-transform:uppercase; color:#94a3b8; font-weight:700;">Event details</div>
            <div style="font-size:20px; font-weight:700; color:#18233b; text-align:center;">${data.eventTitleSnapshot}</div>
            <div style="font-size:15px; color:#64748b; text-align:center; max-width:260px;">${data.venueLine}${data.eventDate ? ` • ${formatShortDate(data.eventDate)}` : ''}</div>
          </div>
          ${rightSignatureBlock}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:18px; gap:20px;">
          <div style="font-size:14px; color:#94a3b8;">Issued on ${data.issueDate}</div>
          <div style="display:flex; align-items:center; gap:10px; color:#94a3b8; font-size:13px; letter-spacing:0.16em; text-transform:uppercase;">
            <span style="display:inline-flex; width:18px; height:18px; align-items:center; justify-content:center; border-radius:999px; background:rgba(197, 138, 45, 0.14);">
              <span style="display:inline-block; width:6px; height:6px; border-radius:999px; background:${accentColor};"></span>
            </span>
            EventDesk Certified
          </div>
        </div>
      </div>
    </div>
  `;
  return wrapper;
}

async function waitForImages(node) {
  const images = Array.from(node.querySelectorAll('img'));
  await Promise.all(images.map((image) => new Promise((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  })));
}

async function renderCertificateCanvas(record) {
  if (!window.html2canvas) {
    throw new Error('Certificate renderer is unavailable on this page.');
  }

  const root = getCertificateRenderRoot();
  root.innerHTML = '';
  const node = createCertificateNode(record);
  root.appendChild(node);
  await waitForImages(node);
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  return window.html2canvas(node, {
    scale: CERTIFICATE_RENDER_SCALE,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#fffdf8'
  });
}

async function savePdf(canvases, fileName) {
  if (!window.jspdf?.jsPDF) {
    throw new Error('PDF engine is unavailable on this page.');
  }

  const width = CERTIFICATE_RENDER_WIDTH;
  const height = CERTIFICATE_RENDER_HEIGHT;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [width, height]
  });

  canvases.forEach((canvas, index) => {
    if (index > 0) {
      pdf.addPage([width, height], 'landscape');
    }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
  });

  pdf.save(fileName);
}

async function downloadCertificatePdf(records, fileName) {
  const canvases = [];
  for (const record of records) {
    canvases.push(await renderCertificateCanvas(record));
  }
  await savePdf(canvases, fileName);
}

async function persistCertificateRecords(records) {
  const batch = writeBatch(db);
  records.forEach((record) => {
    batch.set(doc(db, CERTIFICATE_COLLECTION, record.id), record, { merge: true });
  });
  await batch.commit();
}

export async function fetchEventCertificates(eventId) {
  const snapshot = await getDocs(query(collection(db, CERTIFICATE_COLLECTION), where('eventId', '==', eventId)));
  return sortCertificateRecords(snapshot.docs.map(normalizeRecord));
}

export function subscribeToUserCertificates(userId, onData, onError) {
  return onSnapshot(
    query(collection(db, CERTIFICATE_COLLECTION), where('userId', '==', userId)),
    (snapshot) => onData(sortCertificateRecords(snapshot.docs.map(normalizeRecord))),
    onError
  );
}

export async function downloadIssuedCertificate(record) {
  const normalized = {
    ...record,
    awardRankLabel: rankToLabel(record.awardRank),
    typeLabel: certificateTypeLabel(record.certificateType)
  };
  const fileName = `${normalized.certificateType === 'winner' ? 'Winner' : 'Participation'}_${slugify(normalized.studentName)}_${slugify(normalized.eventTitleSnapshot)}.pdf`;
  await downloadCertificatePdf([normalized], fileName);
  return normalized;
}

export async function issueWinnerCertificate({
  event,
  registration,
  signerName,
  signerTitle,
  coSignerName,
  coSignerTitle,
  awardRank,
  issuedBy = auth.currentUser?.uid
}) {
  if (!registration?.userId || !registration?.registrationId) {
    throw new Error('Select an attended student first.');
  }

  const record = buildCertificateRecord({
    event,
    registration,
    certificateType: 'winner',
    awardRank,
    signerName,
    signerTitle,
    coSignerName,
    coSignerTitle,
    issuedBy
  });

  await persistCertificateRecords([record]);
  await downloadCertificatePdf(
    [{ ...record, awardRankLabel: rankToLabel(record.awardRank), typeLabel: certificateTypeLabel(record.certificateType) }],
    `Winner_${rankToLabel(record.awardRank).replace(/\s+/g, '_')}_${slugify(record.studentName)}_${slugify(record.eventTitleSnapshot)}.pdf`
  );
  return record;
}

export async function issueParticipationCertificates({
  event,
  registrations,
  signerName,
  signerTitle,
  coSignerName,
  coSignerTitle,
  issuedBy = auth.currentUser?.uid
}) {
  const eligible = (Array.isArray(registrations) ? registrations : []).filter((item) => item?.registrationId && item?.userId);
  if (!eligible.length) {
    throw new Error('No attended students are available for participation certificates.');
  }

  const records = eligible.map((registration) => buildCertificateRecord({
    event,
    registration,
    certificateType: 'participation',
    signerName,
    signerTitle,
    coSignerName,
    coSignerTitle,
    issuedBy
  }));
  const pdfRecords = eligible.flatMap((registration) => {
    const baseRecord = buildCertificateRecord({
      event,
      registration,
      certificateType: 'participation',
      signerName,
      signerTitle,
      coSignerName,
      coSignerTitle,
      issuedBy
    });
    const teamMembers = Array.isArray(registration.teamMembers) && registration.teamMembers.length
      ? registration.teamMembers
      : [{ name: registration.name, email: registration.email || '', isLeader: true }];

    return teamMembers
      .filter((member) => String(member?.name || '').trim())
      .map((member) => ({
        ...baseRecord,
        studentName: String(member.name || registration.name || 'Student').trim()
      }));
  });

  await persistCertificateRecords(records);
  await downloadCertificatePdf(
    pdfRecords.map((record) => ({
      ...record,
      awardRankLabel: rankToLabel(record.awardRank),
      typeLabel: certificateTypeLabel(record.certificateType)
    })),
    `Participation_Batch_${slugify(event?.title || 'Event')}.pdf`
  );
  return records;
}

export async function generateCertificate(studentName, eventName, eventDate, userId = auth.currentUser?.uid, eventId = null) {
  if (!userId || !eventId) {
    showToast("Couldn't generate certificate right now. Try again in a moment.", 'error');
    return false;
  }

  const attended = await hasStudentAttended(userId, eventId);
  if (!attended) {
    showToast('Attend the event first to unlock your certificate.', 'warning');
    return false;
  }

  try {
    const fallbackRecord = {
      certificateType: 'participation',
      studentName,
      eventTitleSnapshot: eventName,
      eventDateSnapshot: toDateValue(eventDate)?.toISOString() || null,
      venueSnapshot: '',
      locationSnapshot: '',
      posterUrlSnapshot: '',
      signerName: 'EventDesk',
      signerTitle: 'Certificate Desk',
      awardRank: null
    };
    await downloadCertificatePdf(
      [{ ...fallbackRecord, awardRankLabel: rankToLabel(null), typeLabel: certificateTypeLabel('participation') }],
      `Certificate_${slugify(studentName)}_${slugify(eventName)}.pdf`
    );
    return true;
  } catch (error) {
    console.error(error);
    showToast("Couldn't generate certificate right now. Try again in a moment.", 'error');
    return false;
  }
}
