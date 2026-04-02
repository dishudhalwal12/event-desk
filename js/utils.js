export function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value?.toDate === 'function') {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(timestamp) {
  const date = toDateValue(timestamp);
  if (!date) return 'TBA';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatShortDate(timestamp) {
  const date = toDateValue(timestamp);
  if (!date) return 'TBA';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function getCountdown(eventTimestamp) {
  const eventDate = toDateValue(eventTimestamp) || new Date();
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

export function getCampusEventRegistrationState(event, now = new Date()) {
  const eventDate = toDateValue(event?.date);
  const deadlineDate = toDateValue(event?.regDeadline) || eventDate;
  const registeredCount = Math.max(Number(event?.registeredCount) || 0, 0);
  const seatCap = Math.max(Number(event?.seatCap) || 0, 0);
  const isFull = seatCap > 0 && registeredCount >= seatCap;
  const status = String(event?.status || '').trim().toLowerCase();
  const isCompleted = status === 'completed';
  const hasStarted = eventDate ? eventDate.getTime() <= now.getTime() : false;
  const deadlinePassed = deadlineDate ? deadlineDate.getTime() <= now.getTime() : false;

  let reason = 'open';
  let message = 'Registration is open.';

  if (isCompleted) {
    reason = 'completed';
    message = 'This event has already been completed.';
  } else if (hasStarted) {
    reason = 'started';
    message = 'Registration is closed because the event has already started.';
  } else if (deadlinePassed) {
    reason = 'deadline';
    message = 'Registration is closed because the deadline has passed.';
  } else if (isFull) {
    reason = 'full';
    message = 'This event is full. You can still join the waitlist.';
  }

  return {
    eventDate,
    deadlineDate,
    isFull,
    isCompleted,
    hasStarted,
    deadlinePassed,
    registrationClosed: isCompleted || hasStarted || deadlinePassed,
    canRegister: !isCompleted && !hasStarted && !deadlinePassed && !isFull,
    canJoinWaitlist: !isCompleted && !hasStarted && !deadlinePassed && isFull,
    reason,
    message
  };
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
