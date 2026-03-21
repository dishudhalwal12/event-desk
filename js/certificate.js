import { auth } from './firebase-config.js';
import { hasStudentAttended } from './attendance.js';
import { showToast, slugify } from './utils.js';

export async function generateCertificate(studentName, eventName, eventDate, userId = auth.currentUser?.uid, eventId = null) {
  if (!userId || !eventId) {
    showToast("Couldn't generate certificate 😕 Try again in a moment.", 'error');
    return false;
  }

  const attended = await hasStudentAttended(userId, eventId);
  if (!attended) {
    showToast('Attend the event first to unlock your certificate.', 'warning');
    return false;
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const today = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date());

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 297, 210, 'F');

    doc.setDrawColor(35, 35, 35);
    doc.setLineWidth(0.8);
    doc.rect(4, 4, 289, 202);

    doc.setDrawColor(168, 213, 195);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(11, 11, 275, 188);
    doc.setLineDashPattern([], 0);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(35, 35, 35);
    doc.setFontSize(20);
    if (typeof doc.setCharSpace === 'function') {
      doc.setCharSpace(4);
    }
    doc.text('EVENTDESK', 148.5, 25, { align: 'center' });
    if (typeof doc.setCharSpace === 'function') {
      doc.setCharSpace(0);
    }

    doc.setLineWidth(0.4);
    doc.line(88, 30, 209, 30);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(13);
    doc.text('CERTIFICATE OF PARTICIPATION', 148.5, 36, { align: 'center' });

    doc.setFontSize(11);
    doc.text('This certifies that', 148.5, 52, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(28);
    doc.text(studentName, 148.5, 62, { align: 'center' });

    doc.setDrawColor(35, 35, 35);
    doc.line(104, 70, 193, 70);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(11);
    doc.text('has successfully participated in', 148.5, 78, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(35, 35, 35);
    doc.setFontSize(18);
    doc.text(eventName, 148.5, 87, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(11);
    doc.text(`held on ${eventDate}`, 148.5, 97, { align: 'center' });

    doc.setFontSize(9);
    doc.text(`Issued on ${today}`, 36, 115);
    doc.text('EventDesk — [College Name]', 232, 115);
    doc.text('Powered by EventDesk | eventdesk.web.app', 148.5, 134, { align: 'center' });

    doc.save(`Certificate_${slugify(studentName)}_${slugify(eventName)}.pdf`);
    return true;
  } catch (error) {
    console.error(error);
    showToast("Couldn't generate certificate 😕 Try again in a moment.", 'error');
    return false;
  }
}
