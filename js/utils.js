export function formatDate(timestamp) {
  if (!timestamp) return 'TBA';
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatShortDate(timestamp) {
  if (!timestamp) return 'TBA';
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function getCountdown(eventTimestamp) {
  const eventDate = typeof eventTimestamp?.toDate === 'function' ? eventTimestamp.toDate() : new Date(eventTimestamp);
  const diff = Math.max(eventDate.getTime() - Date.now(), 0);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return {
    days,
    hours,
    minutes,
    seconds,
    isUrgent: diff < 86400000
  };
}

export function validatePhone(phone) {
  return /^[0-9]{10}$/.test(String(phone || '').trim());
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container-custom');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container-custom';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `eventdesk-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('toast-out');
  }, 3600);

  window.setTimeout(() => {
    toast.remove();
    if (!container.children.length) {
      container.remove();
    }
  }, 4100);
}

export function showLoadingSpinner(elementId, message) {
  if (!message) {
    throw new Error('Loading message is required.');
  }

  const element = document.getElementById(elementId);
  if (!element) return;
  if (!element.dataset.originalContent) {
    element.dataset.originalContent = element.innerHTML;
  }

  element.innerHTML = `
    <div class="loading-spinner-wrap">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div class="loading-spinner-text">${message}</div>
    </div>
  `;
}

export function hideLoadingSpinner(elementId, restoreContent = '') {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (restoreContent !== undefined && restoreContent !== null) {
    element.innerHTML = restoreContent;
    return;
  }
  element.innerHTML = element.dataset.originalContent || '';
}

export function getSeatStatus(registeredCount = 0, seatCap = 0) {
  const remaining = Math.max(Number(seatCap) - Number(registeredCount), 0);
  const percentage = seatCap ? (remaining / seatCap) * 100 : 0;
  let label = `${remaining} slots left`;
  let colorClass = 'teal';
  const isUrgent = remaining <= 10;

  if (remaining <= 0) {
    label = 'FULL';
    colorClass = 'red';
  } else if (remaining <= 10) {
    label = `${remaining} left 🔥`;
    colorClass = 'amber';
  }

  return { remaining, percentage, label, colorClass, isUrgent };
}

export function checkOnline() {
  const online = navigator.onLine;
  if (!online) {
    showToast('Please connect to Wi-Fi 📶', 'error');
  }
  return online;
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function setElementText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

export function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'ED';
}

export function hasCustomPoster(posterUrl) {
  const value = String(posterUrl || '').trim();
  if (!value) return false;
  return !value.includes('assets/images/hero.png');
}
