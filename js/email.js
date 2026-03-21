const PUBLIC_KEY = 'YOUR_EMAILJS_PUBLIC_KEY';
const SERVICE_ID = 'YOUR_EMAILJS_SERVICE_ID';
const CONFIRMATION_TEMPLATE = 'YOUR_CONFIRMATION_TEMPLATE_ID';
const WAITLIST_TEMPLATE = 'YOUR_WAITLIST_TEMPLATE_ID';

function hasEmailJsConfig() {
  return ![
    PUBLIC_KEY,
    SERVICE_ID,
    CONFIRMATION_TEMPLATE,
    WAITLIST_TEMPLATE
  ].some((value) => String(value || '').startsWith('YOUR_'));
}

function initEmailJs() {
  if (!hasEmailJsConfig()) {
    return false;
  }

  if (window.emailjs && !window.__eventdeskEmailInitialized) {
    window.emailjs.init(PUBLIC_KEY);
    window.__eventdeskEmailInitialized = true;
  }

  return !!window.emailjs;
}

function createQrDataUrl(qrValue) {
  return new Promise((resolve) => {
    if (!window.QRCode) {
      resolve('');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-9999px';
    document.body.appendChild(wrapper);
    new window.QRCode(wrapper, {
      text: qrValue,
      width: 220,
      height: 220
    });

    window.setTimeout(() => {
      const canvas = wrapper.querySelector('canvas');
      const image = wrapper.querySelector('img');
      const dataUrl = canvas?.toDataURL('image/png') || image?.src || '';
      wrapper.remove();
      resolve(dataUrl);
    }, 100);
  });
}

export async function sendConfirmationEmail(studentName, email, eventName, eventDate, venue, qrValue) {
  if (!initEmailJs()) return false;

  const qr_code_url = await createQrDataUrl(qrValue);
  await window.emailjs.send(SERVICE_ID, CONFIRMATION_TEMPLATE, {
    student_name: studentName,
    event_name: eventName,
    event_date: eventDate,
    venue,
    qr_code_url
  });
  return true;
}

export async function sendWaitlistNotification(studentName, email, eventName, eventUrl) {
  if (!initEmailJs()) return false;

  await window.emailjs.send(SERVICE_ID, WAITLIST_TEMPLATE, {
    student_name: studentName,
    event_name: eventName,
    event_url: eventUrl,
    email
  });
  return true;
}

export { PUBLIC_KEY, SERVICE_ID, CONFIRMATION_TEMPLATE, WAITLIST_TEMPLATE };
