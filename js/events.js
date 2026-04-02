import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { checkAuth, fetchUserProfile, signOutUser } from './auth.js';
import { initScanner, stopScanner } from './attendance.js';
import { promoteFromWaitlist, registerStudent } from './registration.js';
import {
  formatDate,
  formatShortDate,
  getCampusEventRegistrationState,
  getCountdown,
  getInitials,
  getQueryParam,
  getSeatStatus,
  hasCustomPoster,
  hideLoadingSpinner,
  showLoadingSpinner,
  showToast,
  toDateValue,
  validateEmail,
  validatePhone
} from './utils.js';
import {
  getExternalEventById,
  subscribeToExternalEvents,
  subscribeToExternalSyncStatus
} from './external-events.js';
import {
  filterOpportunityFeed,
  getOpportunityCountdownContext,
  getOpportunityDateValue as getOpportunityPrimaryDateValue,
  getOpportunityDeadlineValue,
  getOpportunityLocationValue,
  getOpportunityModeValue,
  getOpportunityParticipationValue,
  getOpportunitySourceLabel,
  getOpportunitySourceTypeLabel,
  getOpportunityTrackValue,
  sortOpportunityFeed
} from './opportunity-utils.js';

let eventsCountdownTimer = null;
let detailCountdownTimer = null;
const MAX_POSTER_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_POSTER_EDGE_PX = 1280;
const MAX_EMBEDDED_POSTER_LENGTH = 420000;
const VALID_POSTER_TYPES = ['image/jpeg', 'image/png'];
const POSTER_STATUS_IDLE = 'No file selected. EventDesk will optimize and save your poster directly in Firestore.';

function splitCommaValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getNormalizedLocation(item) {
  return item.location || item.city || item.venue || 'Campus';
}

function getNormalizedFormat(item) {
  return item.format || item.mode || 'Offline';
}

function getNormalizedTeamSize(item) {
  const raw = item.teamSize ?? item.teamLimit ?? 1;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(1, Math.min(raw, 4));
  }

  const numericValues = String(raw)
    .match(/\d+/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!numericValues?.length) {
    return 1;
  }

  return Math.max(1, Math.min(Math.max(...numericValues), 4));
}

function getParticipationLabel(event) {
  const teamSize = getNormalizedTeamSize(event);
  return teamSize > 1 ? `Teams up to ${teamSize}` : 'Individual';
}

function getTrackHighlight(event) {
  return splitCommaValues(event.tracks)[0] || '';
}

function normalizeEvent(item) {
  return {
    id: item.id || item.eventId,
    eventId: item.id || item.eventId,
    ...item,
    sourceType: 'campus',
    sourceLabel: 'Campus',
    category: item.category || 'Other',
    format: getNormalizedFormat(item),
    location: getNormalizedLocation(item),
    teamSize: getNormalizedTeamSize(item),
    tracks: splitCommaValues(item.tracks),
    eligibility: splitCommaValues(item.eligibility)
  };
}

function isExternalOpportunity(event) {
  return event?.sourceType === 'external';
}

function getOpportunityDetailUrl(event) {
  return isExternalOpportunity(event)
    ? `event-detail.html?id=${event.id}&type=external`
    : `event-detail.html?id=${event.id}`;
}

function toggleElementVisibility(element, shouldShow) {
  if (!element) return;
  element.classList.toggle('d-none', !shouldShow);
}

function setOpportunityChip(element, label, value) {
  if (!element) return;
  if (!value) {
    element.classList.add('d-none');
    return;
  }

  element.innerHTML = `<strong>${label}</strong> ${value}`;
  element.classList.remove('d-none');
}

function buildExternalSignalText(event) {
  if (event.registrationDeadline) {
    return `Applications close: ${formatDate(event.registrationDeadline)}`;
  }

  if (event.startDate) {
    return `Starts: ${formatDate(event.startDate)}`;
  }

  if (event.updatedAt || event.importedAt) {
    return `Recently synced from ${getOpportunitySourceLabel(event.source)}`;
  }

  return `Open the original ${getOpportunitySourceLabel(event.source)} listing`;
}

function buildExternalSecondarySignal(event) {
  const sourceLabel = getOpportunitySourceLabel(event.source);
  if (event.status && event.status !== 'Unknown') {
    return `${event.status} on ${sourceLabel}`;
  }

  if (event.mode) {
    return `${event.mode} • ${sourceLabel}`;
  }

  return `Applications happen on ${sourceLabel}`;
}

function validatePosterFile(file) {
  if (!file) return '';
  if (!VALID_POSTER_TYPES.includes(file.type)) {
    return 'Poster must be a PNG or JPG image.';
  }
  if (file.size > MAX_POSTER_SIZE_BYTES) {
    return 'Poster must be 5MB or smaller.';
  }
  return '';
}

function readPosterFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected poster.'));
    reader.readAsDataURL(file);
  });
}

function loadPosterImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not process the selected poster.'));
    image.src = source;
  });
}

async function uploadEventPoster(_eventId, file) {
  const source = await readPosterFile(file);
  const image = await loadPosterImage(source);
  const scale = Math.min(1, MAX_POSTER_EDGE_PX / Math.max(image.width || 1, image.height || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((image.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((image.height || 1) * scale));
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Poster editor is not available in this browser.');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38]) {
    const embeddedPoster = canvas.toDataURL('image/jpeg', quality);
    if (embeddedPoster.length <= MAX_EMBEDDED_POSTER_LENGTH) {
      return embeddedPoster;
    }
  }

  throw new Error('Poster is too large for the free plan. Try a smaller JPG/PNG or crop it before uploading.');
}

function applyEventPosterPresentation(event, imageElement, fallbackElement) {
  const fallbackTitle = fallbackElement?.querySelector('.event-poster-fallback-title');
  const fallbackKicker = fallbackElement?.querySelector('.event-poster-fallback-kicker');
  const fallbackMeta = fallbackElement?.querySelector('.event-poster-fallback-meta');
  const title = event?.title || 'Campus Event';
  const category = event?.category || 'Campus';

  if (fallbackTitle) fallbackTitle.textContent = title;
  if (fallbackKicker) fallbackKicker.textContent = category;
  if (fallbackMeta) fallbackMeta.textContent = event?.venue || 'EventDesk campus board';

  if (imageElement && hasCustomPoster(event?.posterUrl)) {
    imageElement.src = event.posterUrl;
    imageElement.alt = `${title} poster`;
    imageElement.classList.remove('d-none');
    fallbackElement?.classList.add('d-none');
    imageElement.onerror = () => {
      imageElement.classList.add('d-none');
      fallbackElement?.classList.remove('d-none');
    };
  } else {
    imageElement?.classList.add('d-none');
    fallbackElement?.classList.remove('d-none');
  }
}

function getEventDateValue(event) {
  return toDateValue(event?.date);
}

function formatTimeValue(timestamp) {
  const date = toDateValue(timestamp) || new Date();
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatActivityTime(timestamp) {
  if (!timestamp) return 'Just now';
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(Math.round(diff / 60000), 0);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} day ago`;
}

function filterEvents(events, filters = {}) {
  const {
    category = 'All',
    search = '',
    location = 'All',
    format = 'All',
    team = 'All'
  } = filters;

  return events.filter((event) => {
    const normalizedLocation = getNormalizedLocation(event);
    const teamSize = getNormalizedTeamSize(event);
    const matchesCategory = category === 'All' || event.category === category;
    const matchesLocation = location === 'All' || normalizedLocation === location;
    const matchesFormat = format === 'All' || getNormalizedFormat(event) === format;
    const matchesTeam = team === 'All'
      || (team === 'Solo' && teamSize === 1)
      || (team === 'Team' && teamSize > 1)
      || (team === 'TeamUpTo4' && teamSize === 4);
    const haystack = `${event.title} ${event.description} ${event.venue} ${normalizedLocation} ${event.category} ${splitCommaValues(event.tracks).join(' ')}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());

    return matchesCategory && matchesLocation && matchesFormat && matchesTeam && matchesSearch;
  });
}

function subscribeToEvents(callback, onError) {
  return onSnapshot(
    query(collection(db, 'events'), orderBy('date', 'asc')),
    (snapshot) => {
      const allEvents = snapshot.docs
        .map((item) => normalizeEvent({ id: item.id, ...item.data() }))
        .filter((event) => event.status !== 'Completed');

      callback(allEvents);
    },
    onError
  );
}

function buildMetaLine(event) {
  if (isExternalOpportunity(event)) {
    const primaryDate = getOpportunityPrimaryDateValue(event);
    const parts = [
      primaryDate ? formatShortDate(primaryDate) : '',
      event.organizerName || getOpportunitySourceLabel(event.source),
      getOpportunityModeValue(event)
    ].filter(Boolean);

    return parts.join('  •  ');
  }

  return `${formatShortDate(event.date)}  •  ${event.venue}  •  ${getNormalizedFormat(event)}`;
}

function renderCountdownChip(element, dateValue, label = 'Starts') {
  if (!element || !dateValue) {
    return;
  }

  const countdown = getCountdown(dateValue);
  if (countdown.isUrgent) {
    element.classList.add('urgent');
    element.textContent = `🔴 ${label} in ${countdown.hours} hrs ${countdown.minutes} mins`;
    return;
  }
  element.classList.remove('urgent');
  element.textContent = `${label} in ${countdown.days}d ${countdown.hours}h ${countdown.minutes}m`;
}

function syncEventsCountdowns() {
  document.querySelectorAll('.countdown-chip[data-event-date]').forEach((chip) => {
    renderCountdownChip(chip, chip.dataset.eventDate, chip.dataset.countdownLabel || 'Starts');
  });
}

function updateSeatUI(registeredCount, seatCap) {
  const seatStatus = getSeatStatus(registeredCount, seatCap);
  const usedPercent = seatCap ? Math.min((registeredCount / seatCap) * 100, 100) : 0;
  return {
    ...seatStatus,
    usedPercent
  };
}

function renderEventCards(events) {
  const grid = document.getElementById('eventsGrid');
  const emptyState = document.getElementById('eventsEmptyState');
  const template = document.getElementById('eventCardTemplate');

  if (!grid || !template) return;

  grid.innerHTML = '';
  clearInterval(eventsCountdownTimer);

  if (!events.length) {
    emptyState?.classList.remove('d-none');
    return;
  }

  emptyState?.classList.add('d-none');

  events.forEach((event, index) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.stagger-card');
    const poster = fragment.querySelector('.event-poster');
    const title = fragment.querySelector('.event-title');
    const meta = fragment.querySelector('.event-meta');
    const typeBadge = fragment.querySelector('.opportunity-type-badge');
    const sourceBadge = fragment.querySelector('.source-platform-badge');
    const progressFill = fragment.querySelector('.seat-progress-fill');
    const progressBar = fragment.querySelector('.seat-progress');
    const progressCopy = fragment.querySelector('.seat-progress-copy');
    const seatBadge = fragment.querySelector('.seat-badge');
    const categoryBadge = fragment.querySelector('.badge-category');
    const formatBadge = fragment.querySelector('.event-format-badge');
    const summary = fragment.querySelector('.event-card-summary');
    const locationChip = fragment.querySelector('.event-location-chip');
    const teamChip = fragment.querySelector('.event-team-chip');
    const trackChip = fragment.querySelector('.event-track-chip');
    const deadlineCopy = fragment.querySelector('.event-deadline-copy');
    const detailsButton = fragment.querySelector('.view-details-btn');
    const sourceLink = fragment.querySelector('.event-source-link');
    const countdownChip = fragment.querySelector('.countdown-chip');
    const seatInfo = fragment.querySelector('.info-seats');
    const isExternal = isExternalOpportunity(event);
    const opportunityMode = isExternal ? (getOpportunityModeValue(event) || 'See source') : getNormalizedFormat(event);
    const opportunityLocation = isExternal ? getOpportunityLocationValue(event) : getNormalizedLocation(event);
    const participationValue = isExternal ? getOpportunityParticipationValue(event) : getParticipationLabel(event);
    const trackHighlight = isExternal ? getOpportunityTrackValue(event) : getTrackHighlight(event);
    const primaryDate = isExternal ? getOpportunityPrimaryDateValue(event) : getEventDateValue(event);
    const deadlineDate = isExternal ? getOpportunityDeadlineValue(event) : (event.regDeadline ? getEventDateValue({ date: event.regDeadline }) : null);
    const countdownContext = isExternal ? getOpportunityCountdownContext(event) : { kind: 'start', label: 'Starts' };
    const seatStatus = updateSeatUI(event.registeredCount, event.seatCap);

    card.style.animationDelay = `${index * 80}ms`;
    card.classList.toggle('is-external', isExternal);
    poster.src = event.posterUrl || 'assets/images/hero.png';
    title.textContent = event.title;
    meta.textContent = buildMetaLine(event);
    summary.textContent = isExternal
      ? (event.summary || event.description || 'Open the source page for complete eligibility and application details.')
      : event.description;
    typeBadge.textContent = getOpportunitySourceTypeLabel(event);
    toggleElementVisibility(typeBadge, true);
    sourceBadge.textContent = getOpportunitySourceLabel(event.source);
    toggleElementVisibility(sourceBadge, isExternal);
    categoryBadge.textContent = event.category;
    formatBadge.textContent = opportunityMode;
    setOpportunityChip(locationChip, 'Location', opportunityLocation);
    setOpportunityChip(teamChip, isExternal ? 'Team' : 'Participation', participationValue);

    if (trackHighlight) {
      setOpportunityChip(trackChip, isExternal && event.prizesText ? 'Prize' : 'Track', trackHighlight);
    } else {
      toggleElementVisibility(trackChip, false);
    }

    if (isExternal) {
      toggleElementVisibility(seatBadge, false);
      toggleElementVisibility(progressBar, false);
      toggleElementVisibility(progressCopy, false);
      deadlineCopy.textContent = buildExternalSignalText(event);
      seatInfo.textContent = buildExternalSecondarySignal(event);
      detailsButton.textContent = 'View Details';
      sourceLink.href = event.sourceUrl || '#';
      sourceLink.textContent = `View on ${getOpportunitySourceLabel(event.source)} ↗`;
      toggleElementVisibility(sourceLink, Boolean(event.sourceUrl));
    } else {
      progressFill.style.width = `${seatStatus.usedPercent}%`;
      progressFill.className = `seat-progress-fill ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
      progressCopy.textContent = `${event.registeredCount} / ${event.seatCap} registrations`;
      seatBadge.textContent = seatStatus.label;
      seatBadge.className = `seat-badge ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
      toggleElementVisibility(seatBadge, true);
      toggleElementVisibility(progressBar, true);
      toggleElementVisibility(progressCopy, true);
      deadlineCopy.textContent = deadlineDate
        ? `Registration deadline: ${formatDate(deadlineDate)}`
        : `Opens until the event begins`;
      seatInfo.textContent = `${event.registeredCount} / ${event.seatCap} registrations`;
      detailsButton.textContent = 'View Details';
      toggleElementVisibility(sourceLink, false);
    }

    detailsButton.href = getOpportunityDetailUrl(event);

    if (primaryDate && countdownContext.kind !== 'synced') {
      countdownChip.dataset.eventDate = primaryDate.toISOString();
      countdownChip.dataset.countdownLabel = countdownContext.label;
      toggleElementVisibility(countdownChip, true);
      renderCountdownChip(countdownChip, countdownChip.dataset.eventDate, countdownChip.dataset.countdownLabel);
    } else {
      countdownChip.textContent = '';
      delete countdownChip.dataset.eventDate;
      delete countdownChip.dataset.countdownLabel;
      toggleElementVisibility(countdownChip, false);
    }

    grid.appendChild(fragment);
  });

  eventsCountdownTimer = window.setInterval(syncEventsCountdowns, 1000);
}

function applySort(events, sortValue) {
  return sortOpportunityFeed(events, sortValue);
}

export async function createEvent(eventData) {
  const organizerProfile = await fetchUserProfile(auth.currentUser.uid).catch(() => null);

  const eventRef = doc(collection(db, 'events'));
  let posterUrl = '';
  if (eventData.posterFile) {
    posterUrl = await uploadEventPoster(eventRef.id, eventData.posterFile);
  }
  await setDoc(eventRef, {
    eventId: eventRef.id,
    title: eventData.title,
    description: eventData.description,
    category: eventData.category,
    date: new Date(eventData.date),
    venue: eventData.venue,
    location: eventData.location,
    format: eventData.format,
    seatCap: Number(eventData.seatCap),
    regDeadline: eventData.regDeadline ? new Date(eventData.regDeadline) : null,
    teamSize: Number(eventData.teamSize) || 1,
    tracks: eventData.tracks ? eventData.tracks.split(',').map(t => t.trim()).filter(Boolean) : [],
    eligibility: eventData.eligibility ? eventData.eligibility.split(',').map(e => e.trim()).filter(Boolean) : [],
    timeline: eventData.timeline || null,
    prizes: eventData.prizes || null,
    faqs: eventData.faqs || null,
    registeredCount: 0,
    posterUrl,
    organizerId: auth.currentUser.uid,
    organizerName: organizerProfile?.name || auth.currentUser.displayName || 'Campus Organizer',
    status: 'Upcoming',
    createdAt: serverTimestamp()
  });
}

export async function getEvents(filters = {}) {
  try {
    const eventsQuery = query(collection(db, 'events'), orderBy('date', 'asc'));
    const snapshot = await getDocs(eventsQuery);
    const allEvents = snapshot.docs
      .map((item) => normalizeEvent({ id: item.id, ...item.data() }))
      .filter((event) => event.status !== 'Completed');

    return filterEvents(allEvents, filters);
  } catch (error) {
    console.warn('Campus events unavailable:', error);
    return filterEvents([], filters);
  }
}

async function getCampusEventById(eventId) {
  if (!eventId) {
    return null;
  }

  try {
    const snapshot = await getDoc(doc(db, 'events', eventId));
    if (snapshot.exists()) {
      return normalizeEvent({ id: snapshot.id, ...snapshot.data() });
    }
  } catch (error) {
    console.warn('Campus event detail unavailable:', error);
  }
  return null;
}

export async function getEventById(eventId) {
  return getCampusEventById(eventId);
}

export async function updateEventStatus(eventId, status) {
  await updateDoc(doc(db, 'events', eventId), { status });
}

export function listenToEventRegistrations(eventId, callback) {
  const registrationsQuery = query(
    collection(db, 'registrations'),
    where('eventId', '==', eventId)
  );

  return onSnapshot(registrationsQuery, (snapshot) => {
    const docs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    callback({
      registeredCount: docs.filter((item) => item.status === 'registered').length,
      waitlistedCount: docs.filter((item) => item.status === 'waitlisted').length,
      registrations: docs
    });
  });
}

export async function initEventsPage() {
  const searchInput = document.getElementById('eventSearchInput');
  const sortSelect = document.getElementById('sortEvents');
  const locationSelect = document.getElementById('eventLocationFilter');
  const formatSelect = document.getElementById('eventFormatFilter');
  const teamSelect = document.getElementById('eventTeamFilter');
  const sourceButtons = document.querySelectorAll('#sourcePills .btn-pill');
  const categoryContainer = document.getElementById('categoryPills');
  const initialQuery = getQueryParam('q') || '';
  let campusEvents = [];
  let externalEvents = [];
  let allEvents = [];
  let currentCategory = 'All';
  let currentSource = 'All';
  let externalSyncStatus = null;
  let campusReady = false;
  let externalReady = false;
  let campusLoadError = false;
  let externalLoadError = false;
  const emptyStateTitle = document.getElementById('eventsEmptyStateTitle');
  const emptyStateCopy = document.getElementById('eventsEmptyStateCopy');

  showLoadingSpinner('eventsLoader', 'Loading campus events and external opportunities…');
  if (searchInput) {
    searchInput.value = initialQuery;
  }

  const getSourceScopedEvents = () => (
    currentSource === 'All'
      ? allEvents
      : allEvents.filter((event) => (isExternalOpportunity(event) ? 'external' : 'campus') === currentSource)
  );

  const renderCategoryPills = () => {
    if (!categoryContainer) return;
    const categories = ['All', ...new Set(getSourceScopedEvents().map((event) => event.category).filter(Boolean))];
    if (!categories.includes(currentCategory)) {
      currentCategory = 'All';
    }

    categoryContainer.innerHTML = categories.map((category) => `
      <button class="btn btn-pill ${category === currentCategory ? 'active' : ''}" data-category="${category}">
        ${category === 'All' ? 'All Opportunities' : category}
      </button>
    `).join('');

    categoryContainer.querySelectorAll('.btn-pill').forEach((button) => {
      button.addEventListener('click', () => {
        currentCategory = button.dataset.category;
        renderCategoryPills();
        applyFilters();
      });
    });
  };

  const populateLocations = () => {
    if (!locationSelect) return;
    const currentValue = locationSelect.value || 'All';
    const locations = ['All', ...new Set(getSourceScopedEvents().map((event) => getOpportunityLocationValue(event)).filter(Boolean))];
    locationSelect.innerHTML = locations.map((location) => `
      <option value="${location}">${location === 'All' ? 'All locations' : location}</option>
    `).join('');
    locationSelect.value = locations.includes(currentValue) ? currentValue : 'All';
  };

  const updateResultsHead = (visibleEvents) => {
    const resultMeta = document.getElementById('eventsResultMeta');
    const livePulse = document.getElementById('eventsLivePulse');
    const campusCount = visibleEvents.filter((event) => !isExternalOpportunity(event)).length;
    const externalCount = visibleEvents.filter((event) => isExternalOpportunity(event)).length;
    const metaBits = [`${visibleEvents.length} live opportunity${visibleEvents.length === 1 ? '' : 'ies'} matching your filters.`];

    if (allEvents.length) {
      metaBits.push(`${campusCount} campus`);
      metaBits.push(`${externalCount} external`);
    }

    if ((currentSource === 'All' || currentSource === 'external') && externalSyncStatus?.lastSuccessAt) {
      metaBits.push(`Unstop synced ${formatDate(externalSyncStatus.lastSuccessAt)}`);
    }

    if (campusLoadError && currentSource !== 'external') {
      metaBits.push('Campus feed unavailable right now');
    }

    if (externalLoadError && currentSource !== 'campus') {
      metaBits.push('External feed unavailable right now');
    }

    if (resultMeta) {
      resultMeta.textContent = metaBits.join(' ');
    }

    if (livePulse) {
      livePulse.textContent = `${campusCount} campus • ${externalCount} external`;
    }
  };

  const updateEmptyStateCopy = (visibleEvents) => {
    if (!emptyStateTitle || !emptyStateCopy) return;
    if (visibleEvents.length) return;

    if (currentSource === 'campus' && campusLoadError) {
      emptyStateTitle.textContent = 'Campus events are unavailable right now.';
      emptyStateCopy.textContent = 'EventDesk could not reach the live campus feed. Check Firestore access or refresh the page.';
      return;
    }

    if (currentSource === 'external' && externalLoadError) {
      emptyStateTitle.textContent = 'External opportunities are unavailable right now.';
      emptyStateCopy.textContent = 'EventDesk could not reach the synced external feed. Refresh after Firestore is back online.';
      return;
    }

    if ((campusLoadError || externalLoadError) && !allEvents.length) {
      emptyStateTitle.textContent = 'Live data is unavailable right now.';
      emptyStateCopy.textContent = 'EventDesk could not reach Firestore for the live feed. Check the connection or Firebase rules, then refresh.';
      return;
    }

    if (currentSource === 'external' && !externalEvents.length) {
      emptyStateTitle.textContent = 'No external opportunities synced yet.';
      emptyStateCopy.textContent = externalSyncStatus?.lastSuccessAt
        ? 'The feed is live, but there are no active external opportunities available in Firestore right now.'
        : 'Run the Unstop importer to populate the external opportunities feed, then refresh this page.';
      return;
    }

    emptyStateTitle.textContent = 'No opportunities matched those filters yet.';
    emptyStateCopy.textContent = 'Try widening the filters or switch back to all opportunities.';
  };

  const applyFilters = () => {
    const filtered = filterOpportunityFeed(allEvents, {
      source: currentSource,
      category: currentCategory,
      search: searchInput?.value.trim() || '',
      location: locationSelect?.value || 'All',
      format: formatSelect?.value || 'All',
      team: teamSelect?.value || 'All'
    });
    const sorted = applySort(filtered, sortSelect.value);
    renderEventCards(sorted);
    updateResultsHead(sorted);
    updateEmptyStateCopy(sorted);
  };

  const refreshFeed = () => {
    allEvents = [...campusEvents, ...externalEvents];
    populateLocations();
    renderCategoryPills();
    applyFilters();

    if (campusReady && externalReady) {
      hideLoadingSpinner('eventsLoader', '');
    }
  };

  subscribeToEvents(
    (events) => {
      campusLoadError = false;
      campusEvents = events;
      campusReady = true;
      refreshFeed();
    },
    async (error) => {
      console.warn('Live campus feed unavailable:', error);
      campusLoadError = true;
      campusEvents = await getEvents();
      campusReady = true;
      refreshFeed();
    }
  );

  subscribeToExternalEvents(
    (events) => {
      externalLoadError = false;
      externalEvents = events;
      externalReady = true;
      refreshFeed();
    },
    (error) => {
      console.warn('External opportunities skipped:', error);
      externalLoadError = true;
      externalEvents = [];
      externalReady = true;
      refreshFeed();
    }
  );

  subscribeToExternalSyncStatus(
    (status) => {
      externalSyncStatus = status;
      if (campusReady && externalReady) {
        applyFilters();
      }
    },
    (error) => {
      console.warn('External sync status skipped:', error);
    }
  );

  sourceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sourceButtons.forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      currentSource = button.dataset.source || 'All';
      populateLocations();
      renderCategoryPills();
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);
  sortSelect?.addEventListener('change', applyFilters);
  locationSelect?.addEventListener('change', applyFilters);
  formatSelect?.addEventListener('change', applyFilters);
  teamSelect?.addEventListener('change', applyFilters);
}

function populateDetailCountdown(dateValue, label = 'Event starts in') {
  const countdownWrap = document.getElementById('detailCountdownWrap');
  const countdownPanel = document.getElementById('detailCountdown');
  const countdownLabel = document.getElementById('detailCountdownLabel');

  if (!countdownWrap || !countdownPanel || !countdownLabel) {
    return;
  }

  if (!dateValue) {
    countdownWrap.classList.add('d-none');
    return;
  }

  const countdown = getCountdown(dateValue);
  countdownWrap.classList.remove('d-none');
  countdownLabel.textContent = label;
  document.getElementById('countdownDays').textContent = String(countdown.days).padStart(2, '0');
  document.getElementById('countdownHours').textContent = String(countdown.hours).padStart(2, '0');
  document.getElementById('countdownMinutes').textContent = String(countdown.minutes).padStart(2, '0');
  document.getElementById('countdownSeconds').textContent = String(countdown.seconds).padStart(2, '0');
  countdownPanel.classList.toggle('urgent', countdown.isUrgent);
}

function buildDetailChip(label, value) {
  return `<span class="detail-chip"><strong>${label}</strong> ${value}</span>`;
}

function renderTeamMemberFields(container, count) {
  if (!container) return;
  const cards = [];
  for (let index = 2; index <= count; index += 1) {
    cards.push(`
      <div class="team-member-card">
        <h4>Teammate ${index}</h4>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label" for="teamMemberName${index}">Name</label>
            <input type="text" id="teamMemberName${index}" class="form-control team-member-name" data-member-index="${index}" required>
          </div>
          <div class="col-md-6">
            <label class="form-label" for="teamMemberEmail${index}">Email</label>
            <input type="email" id="teamMemberEmail${index}" class="form-control team-member-email" data-member-index="${index}" required>
          </div>
        </div>
      </div>
    `);
  }
  container.innerHTML = cards.join('');
}

export async function initEventDetailPage() {
  const eventId = getQueryParam('id');
  const requestedType = getQueryParam('type');
  const modalElement = document.getElementById('registrationModal');
  const registrationModal = modalElement ? new bootstrap.Modal(modalElement) : null;
  const registerButton = document.getElementById('registerButton');
  const waitlistButton = document.getElementById('waitlistButton');
  const registrationForm = document.getElementById('registrationForm');
  const registrationSubmitButton = registrationForm?.querySelector('button[type="submit"]');
  const registrationCancelButton = registrationForm?.querySelector('[data-bs-dismiss="modal"]');
  const phoneInput = document.getElementById('registrationPhone');
  const phoneError = document.getElementById('registrationPhoneError');
  const formState = document.getElementById('registrationFormState');
  const successState = document.getElementById('registrationSuccessState');
  const successTitle = successState.querySelector('.success-title');
  const successText = successState.querySelector('p');
  const teamFields = document.getElementById('teamRegistrationFields');
  const teamHint = document.getElementById('teamRegistrationHint');
  const teamBadge = document.getElementById('teamRegistrationBadge');
  const teamNameInput = document.getElementById('teamName');
  const teamMemberCount = document.getElementById('teamMemberCount');
  const teamMembersFields = document.getElementById('teamMembersFields');
  const detailSourceTypeBadge = document.getElementById('detailSourceTypeBadge');
  const detailSourcePlatformPill = document.getElementById('detailSourcePlatformPill');
  const detailContextNote = document.getElementById('detailContextNote');
  const detailLongDescriptionSection = document.getElementById('detailLongDescriptionSection');
  const detailLongDescriptionHeading = document.getElementById('detailLongDescriptionHeading');
  const detailLongDescription = document.getElementById('detailLongDescription');
  const detailCampusStatsWrap = document.getElementById('detailCampusStatsWrap');
  const detailExternalStatsWrap = document.getElementById('detailExternalStatsWrap');
  const registrationActionWrap = document.getElementById('registrationActionWrap');
  const fullStateWrap = document.getElementById('fullStateWrap');
  const fullStateCopy = fullStateWrap?.querySelector('.full-copy');
  const externalActionWrap = document.getElementById('externalActionWrap');
  const externalPrimaryButton = document.getElementById('externalPrimaryButton');
  const externalActionNote = document.getElementById('externalActionNote');
  const detailExternalTypeBadge = document.getElementById('detailExternalTypeBadge');
  const detailSourceBadge = document.getElementById('detailSourceBadge');
  const detailExternalMetaCopy = document.getElementById('detailExternalMetaCopy');
  const detailSourcePlatform = document.getElementById('detailSourcePlatform');
  const detailSourceInlineLink = document.getElementById('detailSourceInlineLink');
  const detailFaqsSectionTitle = document.querySelector('#sectionFaqsWrapper h3');
  const detailTimelineSectionTitle = document.querySelector('#sectionTimelineWrapper h3');
  const detailPrizesSectionTitle = document.querySelector('#sectionPrizesWrapper h3');
  let registrationSubmitting = false;

  const setRegistrationFormBusy = (isBusy, submitLabel = 'Confirm Registration') => {
    if (registrationSubmitButton) {
      if (!registrationSubmitButton.dataset.defaultText) {
        registrationSubmitButton.dataset.defaultText = registrationSubmitButton.textContent;
      }
      registrationSubmitButton.disabled = isBusy;
      registrationSubmitButton.textContent = isBusy
        ? submitLabel
        : registrationSubmitButton.dataset.defaultText;
      registrationSubmitButton.setAttribute('aria-busy', String(isBusy));
    }

    if (registrationCancelButton) {
      registrationCancelButton.disabled = isBusy;
    }
  };

  const resolveEvent = async () => {
    if (requestedType === 'external') {
      return (await getExternalEventById(eventId))
        || (await getCampusEventById(eventId));
    }

    return (await getCampusEventById(eventId))
      || (await getExternalEventById(eventId))
      || null;
  };
  let event = await resolveEvent();
  let liveRegisteredCount = event?.registeredCount || 0;

  showLoadingSpinner('eventDetailLoader', 'Loading event details…');

  const renderUnavailableState = () => {
    document.getElementById('detailTitle').textContent = 'Opportunity unavailable';
    document.getElementById('detailDescription').textContent = 'This listing may have expired or has not been synced into EventDesk yet.';
    document.getElementById('detailPoster').src = 'assets/images/hero.png';
    document.getElementById('detailCategory').textContent = 'Unavailable';
    document.getElementById('detailCategoryText').textContent = 'Unavailable';
    document.getElementById('detailDynamicMeta').classList.add('d-none');
    document.getElementById('detailExtendedSections').classList.add('d-none');
    detailLongDescriptionSection.classList.add('d-none');
    toggleElementVisibility(detailSourceTypeBadge, false);
    toggleElementVisibility(detailSourcePlatformPill, false);
    toggleElementVisibility(detailContextNote, false);
    toggleElementVisibility(detailCampusStatsWrap, false);
    toggleElementVisibility(detailExternalStatsWrap, false);
    toggleElementVisibility(registrationActionWrap, false);
    toggleElementVisibility(fullStateWrap, false);
    toggleElementVisibility(externalActionWrap, false);
    populateDetailCountdown(null);
    hideLoadingSpinner('eventDetailLoader', '');
  };

  if (!event) {
    renderUnavailableState();
    return;
  }

  const renderEvent = () => {
    const isExternal = isExternalOpportunity(event);
    const sourceLabel = isExternal ? getOpportunitySourceLabel(event.source) : 'Campus';
    const summaryText = isExternal
      ? (event.summary || event.description || 'Open the original source listing for complete application details.')
      : event.description;
    const primaryDate = isExternal ? getOpportunityPrimaryDateValue(event) : getEventDateValue(event);
    const countdownContext = isExternal ? getOpportunityCountdownContext(event) : { kind: 'start', label: 'Starts' };
    const deadlineDate = isExternal ? getOpportunityDeadlineValue(event) : (event.regDeadline ? getEventDateValue({ date: event.regDeadline }) : null);
    const metaContainer = document.getElementById('detailDynamicMeta');
    const timelineEl = document.getElementById('detailTimeline');
    const prizesEl = document.getElementById('detailPrizes');
    const faqsEl = document.getElementById('detailFaqs');
    const timelineSection = document.getElementById('sectionTimelineWrapper');
    const prizesSection = document.getElementById('sectionPrizesWrapper');
    const faqsSection = document.getElementById('sectionFaqsWrapper');
    const extendedSections = document.getElementById('detailExtendedSections');

    document.getElementById('detailPoster').src = event.posterUrl || 'assets/images/hero.png';
    document.getElementById('detailCategory').textContent = event.category || (isExternal ? 'External Opportunity' : 'Campus Event');
    document.getElementById('detailTitle').textContent = event.title;
    document.getElementById('detailDescription').textContent = summaryText;
    document.getElementById('detailCategoryText').textContent = event.category || (isExternal ? 'Opportunity' : 'Event');
    document.getElementById('organizerName').textContent = event.organizerName || (isExternal ? sourceLabel : 'Campus Organizer');
    document.getElementById('organizerAvatar').textContent = getInitials(event.organizerName || sourceLabel || 'EventDesk');

    if (isExternal) {
      const longDescription = event.description && event.description !== summaryText ? event.description : '';
      const dynamicMetaContent = [];

      document.getElementById('organizerLabel').textContent = 'Listed by';
      document.getElementById('detailDateLabel').textContent = countdownContext.kind === 'deadline'
        ? 'Deadline'
        : countdownContext.kind === 'synced'
          ? 'Last Synced'
          : 'Start Date';
      document.getElementById('detailTimeLabel').textContent = countdownContext.kind === 'deadline'
        ? 'Time'
        : countdownContext.kind === 'synced'
          ? 'Updated'
          : 'Start Time';
      document.getElementById('detailVenueLabel').textContent = 'Organizer';
      document.getElementById('detailTypeLabel').textContent = 'Opportunity';
      document.getElementById('detailDate').textContent = primaryDate ? formatShortDate(primaryDate) : 'See source';
      document.getElementById('detailTime').textContent = primaryDate ? formatTimeValue(primaryDate) : 'See source';
      document.getElementById('detailVenue').textContent = event.organizerName || sourceLabel;
      document.getElementById('detailDeadline').textContent = deadlineDate ? formatDate(deadlineDate) : 'See source';
      document.getElementById('detailFormat').textContent = getOpportunityModeValue(event) || 'See source';
      document.getElementById('detailLocation').textContent = getOpportunityLocationValue(event) || 'See source';
      document.getElementById('detailParticipation').textContent = getOpportunityParticipationValue(event) || 'See source';

      detailSourceTypeBadge.textContent = 'External Opportunity';
      toggleElementVisibility(detailSourceTypeBadge, true);
      detailSourcePlatformPill.textContent = sourceLabel;
      toggleElementVisibility(detailSourcePlatformPill, true);
      detailContextNote.textContent = `Applications happen on ${sourceLabel}. EventDesk is surfacing this as a discovered opportunity.`;
      toggleElementVisibility(detailContextNote, true);

      if (event.teamSizeText) dynamicMetaContent.push(buildDetailChip('Team', event.teamSizeText));
      if (event.registrationDeadline) dynamicMetaContent.push(buildDetailChip('Deadline', formatShortDate(event.registrationDeadline)));
      if (event.eligibilityText) dynamicMetaContent.push(buildDetailChip('Eligibility', event.eligibilityText));
      if (Array.isArray(event.tags) && event.tags.length) {
        event.tags.slice(0, 3).forEach((tag) => dynamicMetaContent.push(buildDetailChip('Tag', tag)));
      }

      if (dynamicMetaContent.length) {
        metaContainer.innerHTML = dynamicMetaContent.join('');
        metaContainer.classList.remove('d-none');
      } else {
        metaContainer.classList.add('d-none');
      }

      if (longDescription) {
        detailLongDescriptionHeading.textContent = 'About this opportunity';
        detailLongDescription.textContent = longDescription;
        detailLongDescriptionSection.classList.remove('d-none');
      } else {
        detailLongDescriptionSection.classList.add('d-none');
      }

      if (detailTimelineSectionTitle) detailTimelineSectionTitle.textContent = 'Source Notes';
      if (detailPrizesSectionTitle) detailPrizesSectionTitle.textContent = 'Rewards & Prizes';
      if (detailFaqsSectionTitle) detailFaqsSectionTitle.textContent = 'Eligibility';

      if (event.summary && event.summary !== summaryText) {
        timelineEl.textContent = event.summary;
        timelineSection.classList.remove('d-none');
      } else {
        timelineSection.classList.add('d-none');
      }

      if (event.prizesText) {
        prizesEl.textContent = event.prizesText;
        prizesSection.classList.remove('d-none');
      } else {
        prizesSection.classList.add('d-none');
      }

      if (event.eligibilityText) {
        faqsEl.textContent = event.eligibilityText;
        faqsSection.classList.remove('d-none');
      } else {
        faqsSection.classList.add('d-none');
      }

      extendedSections.classList.toggle(
        'd-none',
        timelineSection.classList.contains('d-none')
          && prizesSection.classList.contains('d-none')
          && faqsSection.classList.contains('d-none')
      );

      toggleElementVisibility(detailCampusStatsWrap, false);
      toggleElementVisibility(detailExternalStatsWrap, true);
      toggleElementVisibility(registrationActionWrap, false);
      toggleElementVisibility(fullStateWrap, false);
      toggleElementVisibility(externalActionWrap, true);

      if (detailExternalTypeBadge) {
        detailExternalTypeBadge.textContent = 'External Opportunity';
      }
      if (detailSourceBadge) {
        detailSourceBadge.textContent = sourceLabel;
      }
      if (detailSourcePlatform) {
        detailSourcePlatform.textContent = sourceLabel;
      }
      if (detailExternalMetaCopy) {
        detailExternalMetaCopy.textContent = `Applications happen on ${sourceLabel}. EventDesk is surfacing this as a discovered opportunity.`;
      }
      if (detailSourceInlineLink) {
        detailSourceInlineLink.href = event.sourceUrl || '#';
        toggleElementVisibility(detailSourceInlineLink, Boolean(event.sourceUrl));
      }
      if (externalPrimaryButton) {
        externalPrimaryButton.href = event.sourceUrl || '#';
        externalPrimaryButton.textContent = `View on ${sourceLabel}`;
      }
      if (externalActionNote) {
        externalActionNote.textContent = `Registration or application happens on ${sourceLabel}.`;
      }

      if (teamFields && teamMemberCount && teamMembersFields) {
        teamFields.classList.add('d-none');
        teamMemberCount.innerHTML = '<option value="1">1 participant</option>';
        teamMemberCount.value = '1';
        teamMembersFields.innerHTML = '';
        teamNameInput.value = '';
      }
    } else {
      const dynamicMetaContent = [];
      const teamLimit = getNormalizedTeamSize(event);
      let hasExtended = false;

      document.getElementById('organizerLabel').textContent = 'Organized by';
      document.getElementById('detailDateLabel').textContent = 'Date';
      document.getElementById('detailTimeLabel').textContent = 'Time';
      document.getElementById('detailVenueLabel').textContent = 'Venue';
      document.getElementById('detailTypeLabel').textContent = 'Type';
      document.getElementById('detailDate').textContent = formatShortDate(event.date);
      document.getElementById('detailTime').textContent = formatTimeValue(getEventDateValue(event));
      document.getElementById('detailVenue').textContent = event.venue;
      document.getElementById('detailDeadline').textContent = event.regDeadline ? formatDate(event.regDeadline) : 'Until the event begins';
      document.getElementById('detailFormat').textContent = getNormalizedFormat(event);
      document.getElementById('detailLocation').textContent = getNormalizedLocation(event);
      document.getElementById('detailParticipation').textContent = getParticipationLabel(event);

      toggleElementVisibility(detailSourceTypeBadge, false);
      toggleElementVisibility(detailSourcePlatformPill, false);
      toggleElementVisibility(detailContextNote, false);
      toggleElementVisibility(detailCampusStatsWrap, true);
      toggleElementVisibility(detailExternalStatsWrap, false);
      toggleElementVisibility(externalActionWrap, false);
      detailLongDescriptionSection.classList.add('d-none');

      if (event.teamSize) dynamicMetaContent.push(buildDetailChip('Team', getParticipationLabel(event)));
      if (event.regDeadline) dynamicMetaContent.push(buildDetailChip('Deadline', formatShortDate(event.regDeadline)));
      if (event.tracks && event.tracks.length) {
        event.tracks.forEach((track) => dynamicMetaContent.push(buildDetailChip('Track', track)));
      }
      if (event.eligibility && event.eligibility.length) {
        event.eligibility.forEach((eligibility) => dynamicMetaContent.push(buildDetailChip('Eligibility', eligibility)));
      }

      if (dynamicMetaContent.length) {
        metaContainer.innerHTML = dynamicMetaContent.join('');
        metaContainer.classList.remove('d-none');
      } else {
        metaContainer.classList.add('d-none');
      }

      if (detailTimelineSectionTitle) detailTimelineSectionTitle.textContent = 'Stages & Timeline';
      if (detailPrizesSectionTitle) detailPrizesSectionTitle.textContent = 'Rewards & Prizes';
      if (detailFaqsSectionTitle) detailFaqsSectionTitle.textContent = 'Frequently Asked Questions';

      if (event.timeline) {
        timelineEl.textContent = event.timeline;
        timelineSection.classList.remove('d-none');
        hasExtended = true;
      } else {
        timelineSection.classList.add('d-none');
      }

      if (event.prizes) {
        prizesEl.textContent = event.prizes;
        prizesSection.classList.remove('d-none');
        hasExtended = true;
      } else {
        prizesSection.classList.add('d-none');
      }

      if (event.faqs) {
        faqsEl.textContent = event.faqs;
        faqsSection.classList.remove('d-none');
        hasExtended = true;
      } else {
        faqsSection.classList.add('d-none');
      }

      extendedSections.classList.toggle('d-none', !hasExtended);

      if (teamFields && teamMemberCount && teamMembersFields) {
        if (teamLimit > 1) {
          teamFields.classList.remove('d-none');
          teamHint.textContent = `This ${(event.category || 'event').toLowerCase()} supports team participation with up to ${teamLimit} members.`;
          teamBadge.textContent = `Up to ${teamLimit}`;
          teamMemberCount.innerHTML = Array.from({ length: teamLimit }, (_, index) => {
            const value = index + 1;
            return `<option value="${value}">${value} participant${value === 1 ? '' : 's'}</option>`;
          }).join('');
          if (!teamMemberCount.value || Number(teamMemberCount.value) > teamLimit) {
            teamMemberCount.value = String(teamLimit);
          }
          renderTeamMemberFields(teamMembersFields, Number(teamMemberCount.value));
        } else {
          teamFields.classList.add('d-none');
          teamMemberCount.innerHTML = '<option value="1">1 participant</option>';
          teamMemberCount.value = '1';
          teamNameInput.value = '';
          teamMembersFields.innerHTML = '';
        }
      }

      document.getElementById('registrationModalTitle').textContent = `Register for ${event.title}`;
    }

    clearInterval(detailCountdownTimer);
    if (primaryDate && countdownContext.kind !== 'synced') {
      populateDetailCountdown(primaryDate, isExternal ? `${countdownContext.label} in` : 'Event starts in');
      detailCountdownTimer = window.setInterval(
        () => populateDetailCountdown(primaryDate, isExternal ? `${countdownContext.label} in` : 'Event starts in'),
        1000
      );
    } else {
      populateDetailCountdown(null);
    }

    hideLoadingSpinner('eventDetailLoader', '');
  };

  const syncSeatPanel = (registeredCount) => {
    if (isExternalOpportunity(event)) {
      return;
    }

    const seatStatus = updateSeatUI(registeredCount, event.seatCap);
    const registrationState = getCampusEventRegistrationState({
      ...event,
      registeredCount
    });
    document.getElementById('registeredCount').textContent = registeredCount;
    document.getElementById('seatCap').textContent = event.seatCap;
    document.getElementById('detailProgressFill').style.width = `${seatStatus.usedPercent}%`;
    document.getElementById('detailProgressFill').className = `seat-progress-fill ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
    document.getElementById('detailProgressCopy').textContent = registrationState.registrationClosed
      ? registrationState.message
      : registrationState.canJoinWaitlist
        ? `${registeredCount} / ${event.seatCap} registrations. Waitlist is open.`
        : `${registeredCount} / ${event.seatCap} registrations`;
    const badge = document.getElementById('spotsBadge');
    if (registrationState.registrationClosed) {
      badge.textContent = registrationState.reason === 'completed' ? 'Completed' : 'Registrations closed';
      badge.className = 'badge badge-soft';
      if (fullStateCopy) {
        fullStateCopy.textContent = registrationState.message;
      }
      waitlistButton?.classList.add('d-none');
      registrationActionWrap.classList.add('d-none');
      fullStateWrap.classList.remove('d-none');
      return;
    }

    badge.textContent = seatStatus.label;
    badge.className = seatStatus.colorClass === 'red'
      ? 'badge badge-danger-soft'
      : seatStatus.colorClass === 'amber'
        ? 'badge badge-warning-soft'
        : 'badge badge-category';

    if (registrationState.canJoinWaitlist) {
      if (fullStateCopy) {
        fullStateCopy.textContent = 'This event is full 😔';
      }
      waitlistButton?.classList.remove('d-none');
      registrationActionWrap.classList.add('d-none');
      fullStateWrap.classList.remove('d-none');
      return;
    }

    waitlistButton?.classList.add('d-none');
    registrationActionWrap.classList.remove('d-none');
    fullStateWrap.classList.add('d-none');
  };

  renderEvent();
  syncSeatPanel(liveRegisteredCount);

  if (eventId && !isExternalOpportunity(event)) {
    onSnapshot(doc(db, 'events', eventId), async (snapshot) => {
      if (!snapshot.exists()) {
        renderUnavailableState();
        return;
      }
      event = normalizeEvent({ id: snapshot.id, ...snapshot.data() });
      liveRegisteredCount = event.registeredCount ?? liveRegisteredCount;
      renderEvent();
      syncSeatPanel(liveRegisteredCount);
    });
  }

  const openRegistrationFlow = async () => {
    if (isExternalOpportunity(event)) {
      if (event.sourceUrl) {
        window.open(event.sourceUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    const registrationState = getCampusEventRegistrationState({
      ...event,
      registeredCount: liveRegisteredCount
    });
    if (!registrationState.canRegister && !registrationState.canJoinWaitlist) {
      showToast(registrationState.message, 'warning');
      return;
    }

    if (!auth.currentUser) {
      window.location.href = 'login.html';
      return;
    }

    const profile = await fetchUserProfile(auth.currentUser.uid);
    if (profile?.role !== 'student') {
      window.location.href = 'organizer-dashboard.html';
      return;
    }

    document.getElementById('registrationName').value = profile.name || '';
    document.getElementById('registrationPhone').value = profile.phone || '';
    document.getElementById('registrationModalTitle').textContent = registrationState.canJoinWaitlist
      ? `Join waitlist for ${event.title}`
      : `Register for ${event.title}`;
    phoneError.classList.add('d-none');
    formState.classList.remove('d-none');
    successState.classList.add('d-none');
    if (getNormalizedTeamSize(event) > 1) {
      if (!teamMemberCount.value) {
        teamMemberCount.value = String(getNormalizedTeamSize(event));
      }
      renderTeamMemberFields(teamMembersFields, Number(teamMemberCount.value));
    }
    registrationModal?.show();
  };

  registerButton?.addEventListener('click', openRegistrationFlow);
  waitlistButton?.addEventListener('click', openRegistrationFlow);

  phoneInput?.addEventListener('blur', () => {
    const valid = validatePhone(phoneInput.value.trim());
    phoneInput.classList.toggle('is-invalid', !valid);
    phoneError.classList.toggle('d-none', valid);
    if (!valid) {
      showToast('Phone number please 📞', 'error');
    }
  });

  teamMemberCount?.addEventListener('change', () => {
    renderTeamMemberFields(teamMembersFields, Number(teamMemberCount.value));
  });

  registrationForm?.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (registrationSubmitting) {
      return;
    }
    if (isExternalOpportunity(event)) {
      return;
    }

    const phone = phoneInput.value.trim();
    if (!validatePhone(phone)) {
      phoneInput.classList.add('is-invalid');
      phoneError.classList.remove('d-none');
      showToast('Phone number please 📞', 'error');
      return;
    }

    const teamLimit = getNormalizedTeamSize(event);
    const teamPayload = {
      teamName: '',
      teamSize: 1,
      teamMembers: []
    };

    if (teamLimit > 1) {
      const participantCount = Number(teamMemberCount.value || teamLimit);
      const memberNames = [...registrationForm.querySelectorAll('.team-member-name')];
      const memberEmails = [...registrationForm.querySelectorAll('.team-member-email')];

      if (!teamNameInput.value.trim()) {
        showToast('Give your team a name so everyone is grouped correctly.', 'error');
        teamNameInput.focus();
        return;
      }

      const additionalMembers = [];
      for (let index = 0; index < participantCount - 1; index += 1) {
        const name = memberNames[index]?.value.trim();
        const email = memberEmails[index]?.value.trim();
        if (!name || !validateEmail(email)) {
          showToast('Please add valid teammate names and emails.', 'error');
          return;
        }
        additionalMembers.push({ name, email });
      }

      teamPayload.teamName = teamNameInput.value.trim();
      teamPayload.teamSize = participantCount;
      teamPayload.teamMembers = additionalMembers;
    }

    const registrationState = getCampusEventRegistrationState({
      ...event,
      registeredCount: liveRegisteredCount
    });
    registrationSubmitting = true;
    setRegistrationFormBusy(
      true,
      registrationState.canJoinWaitlist ? 'Joining waitlist...' : 'Registering...'
    );

    try {
      const result = await registerStudent(auth.currentUser.uid, event.id, phone, teamPayload);
      formState.classList.add('d-none');
      successState.classList.remove('d-none');

      if (result.waitlisted) {
        successTitle.textContent = "You're queued! ⏳";
        successText.textContent = `You are #${result.position} in queue. We'll notify you if a spot opens.`;
        showToast("You're queued! ⏳ We'll notify you if a spot opens.", 'success');
      } else {
        successTitle.textContent = "You're in! 🎉";
        successText.textContent = 'Check your email for your QR code.';
        showToast("You're in! 🎉 Check your email for the QR code.", 'success');
      }
    } catch (error) {
      if (String(error.message).includes('This event is full')) {
        showToast('This event is full 😔 Try the waitlist!', 'error');
      } else {
        showToast(error.message || 'Could not save your registration right now.', 'error');
      }
    } finally {
      registrationSubmitting = false;
      setRegistrationFormBusy(false);
    }
  });

  modalElement?.addEventListener('hidden.bs.modal', () => {
    if (isExternalOpportunity(event)) {
      return;
    }

    formState.classList.remove('d-none');
    successState.classList.add('d-none');
    registrationForm.reset();
    registrationSubmitting = false;
    setRegistrationFormBusy(false);
    phoneError.classList.add('d-none');
    phoneInput.classList.remove('is-invalid');
    if (getNormalizedTeamSize(event) > 1) {
      teamMemberCount.value = String(getNormalizedTeamSize(event));
      renderTeamMemberFields(teamMembersFields, Number(teamMemberCount.value));
    } else {
      teamMembersFields.innerHTML = '';
    }
  });
}

async function getOrganizerEventMetrics(eventId) {
  const registrationsSnapshot = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
  const attendanceSnapshot = await getDocs(query(collection(db, 'attendance'), where('eventId', '==', eventId)));
  const registrations = registrationsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const attendanceEntries = attendanceSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const registered = registrations.filter((item) => item.status === 'registered').length;
  const waitlisted = registrations.filter((item) => item.status === 'waitlisted').length;
  const attended = attendanceEntries.length;
  const rate = registered ? ((attended / registered) * 100).toFixed(1) : '0.0';

  return { registrations, attendanceEntries, registered, waitlisted, attended, rate };
}

function shouldShowCompleteButton(event) {
  const datePassed = getEventDateValue(event).getTime() < Date.now();
  return datePassed && ['Upcoming', 'Ongoing'].includes(event.status);
}

function getOrganizerStatusClass(event, metrics) {
  if (event.status === 'Completed') return 'completed';
  if (metrics.registered >= event.seatCap) return 'full';
  if (metrics.waitlisted > 0 || shouldShowCompleteButton(event)) return 'attention';
  return '';
}

function getOrganizerInsightCopy(event, metrics) {
  if (event.status === 'Completed') {
    return `Event completed. ${metrics.attended} students checked in and certificates are now unlocked.`;
  }
  if (shouldShowCompleteButton(event)) {
    return 'The event date has passed. Mark it completed so attended students can download certificates.';
  }
  if (metrics.waitlisted > 0 && metrics.registered >= event.seatCap) {
    return `${metrics.waitlisted} students are waiting for a spot. Promote from the waitlist as seats open up.`;
  }
  if (metrics.registered >= event.seatCap) {
    return 'You are at full capacity. Scan attendance smoothly and manage overflow from the waitlist.';
  }
  if (metrics.registered === 0) {
    return 'Freshly live. Share the event link and watch registrations arrive here in real time.';
  }
  return `${Math.max(event.seatCap - metrics.registered, 0)} seats still open and attendance tracking is ready for event day.`;
}

function getOrganizerFocusMeta(eventModel) {
  if (shouldShowCompleteButton(eventModel.event)) {
    return {
      tag: 'Ready to complete',
      badge: `Completion queue: ${eventModel.event.title}`,
      metric: 'Mark completed to unlock certificates'
    };
  }
  if (eventModel.metrics.waitlisted > 0) {
    return {
      tag: 'Waitlist pressure',
      badge: `Waitlist pressure: ${eventModel.event.title}`,
      metric: `${eventModel.metrics.waitlisted} student${eventModel.metrics.waitlisted === 1 ? '' : 's'} waiting`
    };
  }
  if (eventModel.metrics.registered >= eventModel.event.seatCap) {
    return {
      tag: 'At capacity',
      badge: `At capacity: ${eventModel.event.title}`,
      metric: `${eventModel.metrics.registered}/${eventModel.event.seatCap} seats filled`
    };
  }
  if (eventModel.event.status === 'Completed') {
    return {
      tag: 'Completed event',
      badge: `Completed: ${eventModel.event.title}`,
      metric: `${eventModel.metrics.attended} students checked in`
    };
  }
  return {
    tag: 'Busiest live event',
    badge: `Live focus: ${eventModel.event.title}`,
    metric: `${eventModel.metrics.registered}/${eventModel.event.seatCap} seats filled`
  };
}

function renderRegistrationRows(target, registrations, attendedUserIds) {
  target.innerHTML = '';
  if (!registrations.length) {
    target.innerHTML = '<p class="text-muted mb-0">No registered students yet.</p>';
    return;
  }

  registrations.forEach((item) => {
    const attended = attendedUserIds.has(item.userId);
    const teamCopy = item.participantCount > 1
      ? `<div class="text-muted small">${item.teamName ? `${item.teamName} • ` : ''}${item.participantCount} participants</div>`
      : '';
    const row = document.createElement('div');
    row.className = 'registration-item';
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <div class="text-muted small">${item.phone || 'Phone unavailable'}</div>
        ${teamCopy}
        <div class="text-muted small">${attended ? 'Attendance marked ✅' : 'Waiting for QR scan'}</div>
      </div>
      <span class="badge ${attended ? 'badge-success' : 'badge-soft'} text-uppercase">${attended ? 'Attended' : item.status}</span>
    `;
    target.appendChild(row);
  });
}

function renderWaitlistRows(target, items, eventModel, onPromote) {
  target.innerHTML = '';
  if (!items.length) {
    target.innerHTML = '<p class="text-muted mb-0">Waitlist is empty right now.</p>';
    return;
  }

  const spotsOpen = Math.max((eventModel.event.seatCap || 0) - (eventModel.metrics.registered || 0), 0);
  items
    .sort((left, right) => (left.waitlistPos || 0) - (right.waitlistPos || 0))
    .forEach((item) => {
      const teamCopy = item.participantCount > 1
        ? `<div class="text-muted small">${item.teamName ? `${item.teamName} • ` : ''}${item.participantCount} participants</div>`
        : '';
      const row = document.createElement('div');
      row.className = 'waitlist-item';
      row.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <div class="text-muted small">Queue Position #${item.waitlistPos}</div>
          ${teamCopy}
          <div class="text-muted small">${spotsOpen > 0 ? `${spotsOpen} seat${spotsOpen === 1 ? '' : 's'} open now` : 'Waiting for a seat to open'}</div>
        </div>
      `;
      const button = document.createElement('button');
      button.className = 'btn btn-outline-primary btn-sm';
      button.textContent = 'Promote 🚀';
      button.disabled = spotsOpen <= 0;
      button.addEventListener('click', () => onPromote(item));
      row.appendChild(button);
      target.appendChild(row);
    });
}

function matchesOrganizerFilter(eventModel, filter) {
  if (filter === 'upcoming') {
    return eventModel.event.status !== 'Completed';
  }
  if (filter === 'completed') {
    return eventModel.event.status === 'Completed';
  }
  if (filter === 'attention') {
    return eventModel.metrics.waitlisted > 0
      || eventModel.metrics.registered >= eventModel.event.seatCap
      || shouldShowCompleteButton(eventModel.event);
  }
  return true;
}

function renderOrganizerPanels(eventModels) {
  const focusEvent = eventModels.find((item) => shouldShowCompleteButton(item.event))
    || eventModels.find((item) => item.metrics.waitlisted > 0)
    || eventModels.find((item) => item.metrics.registered >= item.event.seatCap)
    || [...eventModels].sort((left, right) => (right.metrics.registered / Math.max(right.event.seatCap, 1)) - (left.metrics.registered / Math.max(left.event.seatCap, 1)))[0];

  if (focusEvent) {
    const focusMeta = getOrganizerFocusMeta(focusEvent);
    document.getElementById('organizerFocusTag').textContent = focusMeta.tag;
    document.getElementById('organizerFocusTitle').textContent = focusEvent.event.title;
    document.getElementById('organizerFocusCopy').textContent = getOrganizerInsightCopy(focusEvent.event, focusEvent.metrics);
    document.getElementById('organizerFocusMetric').textContent = focusMeta.metric;
    document.getElementById('organizerFocusVenue').textContent = focusEvent.event.venue || 'Venue TBA';
    document.getElementById('organizerHeroBadge').textContent = focusMeta.badge;
  } else {
    document.getElementById('organizerFocusTag').textContent = 'No live events yet';
    document.getElementById('organizerFocusTitle').textContent = 'Create your first event to activate the dashboard.';
    document.getElementById('organizerFocusCopy').textContent = 'When registrations begin, this panel will highlight your busiest event or the one that needs your attention next.';
    document.getElementById('organizerFocusMetric').textContent = 'Publish something great';
    document.getElementById('organizerFocusVenue').textContent = 'Waiting on your first event';
    document.getElementById('organizerHeroBadge').textContent = 'Realtime registration + attendance sync';
  }

  const categorySummary = eventModels.reduce((accumulator, item) => {
    const category = item.event.category || 'Other';
    if (!accumulator[category]) {
      accumulator[category] = { count: 0, registered: 0 };
    }
    accumulator[category].count += 1;
    accumulator[category].registered += item.metrics.registered;
    return accumulator;
  }, {});

  const categoryEntries = Object.entries(categorySummary).sort((left, right) => right[1].registered - left[1].registered);
  document.getElementById('organizerCategorySummary').textContent = `${categoryEntries.length} categories`;
  if (!categoryEntries.length) {
    document.getElementById('organizerCategoryBreakdown').classList.add('empty');
    document.getElementById('organizerCategoryBreakdown').innerHTML = '<p class="empty-inline-copy mb-0">Category mix appears here once you start publishing events.</p>';
  } else {
    const target = document.getElementById('organizerCategoryBreakdown');
    target.classList.remove('empty');
    target.innerHTML = categoryEntries.map(([category, values]) => `
      <div class="stack-list-item">
        <strong>${category}</strong>
        <span>${values.count} event${values.count === 1 ? '' : 's'}</span>
        <small>${values.registered} total registrations</small>
      </div>
    `).join('');
  }

  const activityEntries = eventModels.flatMap((item) => {
    const registrationActivity = item.metrics.registrations
      .filter((registration) => registration.status !== 'cancelled')
      .map((registration) => ({
        title: registration.status === 'waitlisted'
          ? `${registration.name} joined the waitlist`
          : `${registration.name} registered`,
        subtitle: item.event.title,
        time: registration.registeredAt
      }));
    const attendanceActivity = item.metrics.attendanceEntries.map((attendance) => ({
      title: `${attendance.studentName} checked in`,
      subtitle: item.event.title,
      time: attendance.scannedAt
    }));
    return [...registrationActivity, ...attendanceActivity];
  })
    .sort((left, right) => {
      const leftTime = left.time?.toMillis ? left.time.toMillis() : new Date(left.time || 0).getTime();
      const rightTime = right.time?.toMillis ? right.time.toMillis() : new Date(right.time || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 4);

  document.getElementById('organizerActivitySummary').textContent = `${activityEntries.length} updates`;
  if (!activityEntries.length) {
    document.getElementById('organizerRecentActivity').classList.add('empty');
    document.getElementById('organizerRecentActivity').innerHTML = '<p class="empty-inline-copy mb-0">New registrations, scans, and waitlist pressure will surface here in real time.</p>';
  } else {
    const target = document.getElementById('organizerRecentActivity');
    target.classList.remove('empty');
    target.innerHTML = activityEntries.map((entry) => `
      <div class="stack-list-item">
        <strong>${entry.title}</strong>
        <span>${entry.subtitle}</span>
        <small>${formatActivityTime(entry.time)}</small>
      </div>
    `).join('');
  }

  const attentionEntries = eventModels
    .filter((item) => item.metrics.waitlisted > 0 || item.metrics.registered >= item.event.seatCap || shouldShowCompleteButton(item.event))
    .slice(0, 4);
  document.getElementById('organizerAttentionSummary').textContent = `${attentionEntries.length} alerts`;
  if (!attentionEntries.length) {
    document.getElementById('organizerAttentionList').classList.add('empty');
    document.getElementById('organizerAttentionList').innerHTML = '<p class="empty-inline-copy mb-0">Events that are full, have waitlists, or are ready for completion will show up here.</p>';
  } else {
    const target = document.getElementById('organizerAttentionList');
    target.classList.remove('empty');
    target.innerHTML = attentionEntries.map((item) => `
      <div class="stack-list-item">
        <strong>${item.event.title}</strong>
        <span>${item.metrics.waitlisted > 0 ? `${item.metrics.waitlisted} on waitlist` : item.metrics.registered >= item.event.seatCap ? 'At full capacity' : 'Ready to complete'}</span>
        <small>${formatShortDate(item.event.date)} • ${item.event.venue || 'Venue TBA'}</small>
      </div>
    `).join('');
  }
}

function renderOrganizerEvents(eventModels, handlers) {
  const list = document.getElementById('organizerEventsList');
  const template = document.getElementById('organizerEventCardTemplate');

  list.innerHTML = '';

  if (!eventModels.length) {
    list.innerHTML = `
      <div class="card">
        <div class="card-body text-center py-5">
          <h3 class="mb-2">No events live yet</h3>
          <p class="text-muted mb-0">Create your first event and the dashboard will populate here.</p>
        </div>
      </div>
    `;
    return;
  }

  eventModels.forEach((eventModel) => {
    const fragment = template.content.cloneNode(true);
    const seatStatus = updateSeatUI(eventModel.metrics.registered, eventModel.event.seatCap);
    const completeButton = fragment.querySelector('.complete-btn');
    const statusChip = fragment.querySelector('.organizer-status');
    const statusClass = getOrganizerStatusClass(eventModel.event, eventModel.metrics);

    applyEventPosterPresentation(
      eventModel.event,
      fragment.querySelector('.organizer-thumb'),
      fragment.querySelector('.organizer-poster-fallback')
    );
    fragment.querySelector('.organizer-category').textContent = eventModel.event.category;
    statusChip.textContent = eventModel.event.status;
    statusChip.className = `organizer-status-chip organizer-status ${statusClass}`.trim();
    fragment.querySelector('.organizer-event-title').textContent = eventModel.event.title;
    fragment.querySelector('.organizer-event-copy').textContent = eventModel.event.description;
    fragment.querySelector('.organizer-event-date').textContent = `${formatShortDate(eventModel.event.date)} • ${formatTimeValue(eventModel.event.date)}`;
    fragment.querySelector('.organizer-event-venue').textContent = eventModel.event.venue || 'Venue TBA';
    fragment.querySelector('.organizer-seat-note').textContent = seatStatus.label;
    fragment.querySelector('.metric-registered').textContent = `${eventModel.metrics.registered} / ${eventModel.event.seatCap}`;
    fragment.querySelector('.metric-attended').textContent = String(eventModel.metrics.attended);
    fragment.querySelector('.metric-waitlisted').textContent = String(eventModel.metrics.waitlisted);
    fragment.querySelector('.metric-rate').textContent = `${eventModel.metrics.rate}%`;
    fragment.querySelector('.organizer-event-stats').textContent = `Registered: ${eventModel.metrics.registered}/${eventModel.event.seatCap}`;
    fragment.querySelector('.organizer-event-rate').textContent = `Attendance Rate: ${eventModel.metrics.rate}%`;
    fragment.querySelector('.organizer-insight-banner').textContent = getOrganizerInsightCopy(eventModel.event, eventModel.metrics);

    const progressFill = fragment.querySelector('.seat-progress-fill');
    progressFill.style.width = `${seatStatus.usedPercent}%`;
    progressFill.className = `seat-progress-fill ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();

    fragment.querySelector('.view-link').href = `event-detail.html?id=${eventModel.event.id}`;
    fragment.querySelector('.scan-btn').addEventListener('click', () => handlers.onScan(eventModel));
    fragment.querySelector('.manage-btn').addEventListener('click', () => handlers.onManage(eventModel));

    if (!shouldShowCompleteButton(eventModel.event)) {
      completeButton.classList.add('d-none');
    } else {
      completeButton.addEventListener('click', () => handlers.onComplete(eventModel));
    }

    list.appendChild(fragment);
  });
}

export async function initOrganizerDashboard() {
  const { user } = await checkAuth('organizer');
  const createEventModalElement = document.getElementById('createEventModal');
  const createEventModal = new bootstrap.Modal(createEventModalElement);
  const manageEventModal = new bootstrap.Modal(document.getElementById('manageEventModal'));
  const completeEventModal = new bootstrap.Modal(document.getElementById('completeEventModal'));
  const scannerModalElement = document.getElementById('scannerModal');
  const scannerModal = new bootstrap.Modal(scannerModalElement);
  const createEventButton = document.getElementById('openCreateEventButton');
  const createEventForm = document.getElementById('createEventForm');
  const posterDropzone = document.getElementById('eventPosterDropzone');
  const posterInput = document.getElementById('eventPoster');
  const posterPreviewImage = document.getElementById('eventPosterPreviewImage');
  const posterPlaceholder = document.getElementById('eventPosterPlaceholder');
  const posterStatus = document.getElementById('eventPosterStatus');
  const signOutButton = document.getElementById('organizerSignOutButton');
  const refreshWaitlistButton = document.getElementById('refreshWaitlistButton');
  const filterButtons = document.querySelectorAll('#organizerFilterPills .btn-pill');
  let selectedManageEventId = null;
  let pendingCompleteEvent = null;
  let allEventModels = [];
  let activeFilter = 'all';
  let selectedPosterFile = null;
  let posterPreviewUrl = '';

  signOutButton?.addEventListener('click', async () => {
    await signOutUser();
  });

  createEventButton?.addEventListener('click', () => createEventModal.show());
  if (posterStatus) {
    posterStatus.textContent = POSTER_STATUS_IDLE;
  }

  const resetPosterSelection = () => {
    selectedPosterFile = null;
    if (posterPreviewUrl) {
      URL.revokeObjectURL(posterPreviewUrl);
      posterPreviewUrl = '';
    }
    posterPreviewImage?.classList.add('d-none');
    if (posterPreviewImage) posterPreviewImage.src = '';
    posterPlaceholder?.classList.remove('d-none');
    if (posterInput) posterInput.value = '';
    if (posterStatus) posterStatus.textContent = POSTER_STATUS_IDLE;
  };

  const setPosterFile = (file) => {
    const validationError = validatePosterFile(file);
    if (validationError) {
      showToast(validationError, 'error');
      if (posterStatus) posterStatus.textContent = validationError;
      return false;
    }

    if (posterPreviewUrl) {
      URL.revokeObjectURL(posterPreviewUrl);
    }

    selectedPosterFile = file;
    posterPreviewUrl = URL.createObjectURL(file);
    if (posterPreviewImage) {
      posterPreviewImage.src = posterPreviewUrl;
      posterPreviewImage.classList.remove('d-none');
    }
    posterPlaceholder?.classList.add('d-none');
    if (posterStatus) {
      posterStatus.textContent = `${file.name} selected. EventDesk will optimize and save it directly in Firestore.`;
    }
    return true;
  };

  posterDropzone?.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) return;
    posterInput?.click();
  });

  posterDropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      posterInput?.click();
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    posterDropzone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      posterDropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
    posterDropzone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      posterDropzone.classList.remove('is-dragover');
    });
  });

  posterDropzone?.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    setPosterFile(file);
  });

  posterInput?.addEventListener('change', () => {
    const file = posterInput.files?.[0];
    if (!file) {
      resetPosterSelection();
      return;
    }
    setPosterFile(file);
  });

  createEventModalElement?.addEventListener('hidden.bs.modal', () => {
    createEventForm?.reset();
    resetPosterSelection();
  });



  createEventForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = document.getElementById('eventTitle').value.trim();
    const description = document.getElementById('eventDescription').value.trim();
    const category = document.getElementById('eventCategory').value;
    const date = document.getElementById('eventDateTime').value;
    const venue = document.getElementById('eventVenue').value.trim();
    const location = document.getElementById('eventLocation').value.trim();
    const format = document.getElementById('eventFormat').value;
    const seatCap = document.getElementById('eventSeatCap').value;
    const regDeadline = document.getElementById('eventRegDeadline').value;
    const teamSize = document.getElementById('eventTeamSize').value;
    const tracks = document.getElementById('eventTracks').value.trim();
    const eligibility = document.getElementById('eventEligibility').value.trim();
    const timeline = document.getElementById('eventTimeline').value.trim();
    const prizes = document.getElementById('eventPrizes').value.trim();
    const faqs = document.getElementById('eventFaqs').value.trim();

    if (!title || !description || !category || !date || !venue || !location || !seatCap) {
      showToast('Please fill in all fields before creating the event.', 'error');
      return;
    }

    if (new Date(date).getTime() <= Date.now()) {
      showToast('Choose an event date in the future.', 'error');
      return;
    }

    if (regDeadline && new Date(regDeadline).getTime() > new Date(date).getTime()) {
      showToast('Registration deadline must be before the event start time.', 'error');
      return;
    }

    if (selectedPosterFile) {
      const validationError = validatePosterFile(selectedPosterFile);
      if (validationError) {
        showToast(validationError, 'error');
        return;
      }
    }

    const submitBtn = createEventForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating event...';

    try {
      await createEvent({ 
        title, description, category, date, venue, location, format, seatCap, posterFile: selectedPosterFile,
        regDeadline, teamSize, tracks, eligibility, timeline, prizes, faqs
      });
      showToast('Event live! 🚀 Students can register now.', 'success');
      createEventModal.hide();
      resetPosterSelection();
    } catch (error) {
      showToast(error.message || 'Could not create event right now.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  const findSelectedManageEvent = () => allEventModels.find((item) => item.event.id === selectedManageEventId);

  async function populateManageModal(eventModel) {
    selectedManageEventId = eventModel.event.id;
    document.getElementById('manageEventTitle').textContent = eventModel.event.title;
    const manageBadge = document.getElementById('manageEventBadge');
    manageBadge.textContent = eventModel.event.status;
    manageBadge.className = eventModel.event.status === 'Completed'
      ? 'badge badge-success'
      : eventModel.metrics.waitlisted > 0
        ? 'badge badge-warning-soft'
        : 'badge badge-category';
    document.getElementById('manageEventMeta').textContent = `${formatShortDate(eventModel.event.date)} • ${eventModel.event.venue || 'Venue TBA'}`;
    document.getElementById('manageRegisteredCount').textContent = eventModel.metrics.registered;
    document.getElementById('manageAttendanceCount').textContent = eventModel.metrics.attended;
    document.getElementById('manageWaitlistCount').textContent = eventModel.metrics.waitlisted;
    renderRegistrationRows(
      document.getElementById('manageRegistrationsList'),
      eventModel.metrics.registrations.filter((item) => item.status === 'registered'),
      new Set(eventModel.metrics.attendanceEntries.map((item) => item.userId))
    );
    renderWaitlistRows(
      document.getElementById('manageWaitlistList'),
      eventModel.metrics.registrations.filter((item) => item.status === 'waitlisted'),
      eventModel,
      async (waitlistItem) => {
        try {
          const result = await promoteFromWaitlist(eventModel.event.id, waitlistItem.registrationId || waitlistItem.id);
          showToast(`Spot offered to ${result.name}! 🚀`, 'success');
        } catch (error) {
          showToast(error.message || 'Could not promote right now.', 'error');
        }
      }
    );
  }

  refreshWaitlistButton?.addEventListener('click', async () => {
    const selectedEvent = findSelectedManageEvent();
    if (selectedEvent) {
      await populateManageModal(selectedEvent);
    }
  });

  document.getElementById('confirmCompleteButton')?.addEventListener('click', async () => {
    if (!pendingCompleteEvent) return;
    await updateEventStatus(pendingCompleteEvent.event.id, 'Completed');
    completeEventModal.hide();
    showToast('Event marked as completed ✅', 'success');
  });

  document.getElementById('closeScannerButton')?.addEventListener('click', async () => {
    await stopScanner();
  });

  scannerModalElement?.addEventListener('hidden.bs.modal', async () => {
    await stopScanner();
    document.getElementById('scannerResultCard').className = 'scanner-result-card';
    document.getElementById('scannerResultCard').innerHTML = '<strong>Ready to scan</strong><span>Results appear here after each QR check-in.</span>';
  });

  const actionHandlers = {
    onScan: async (eventModel) => {
      document.getElementById('scannerEventName').textContent = eventModel.event.title;
      scannerModal.show();
      await initScanner('qr-reader', eventModel.event.id);
    },
    onManage: async (eventModel) => {
      await populateManageModal(eventModel);
      manageEventModal.show();
    },
    onComplete: (eventModel) => {
      pendingCompleteEvent = eventModel;
      document.getElementById('completeEventMessage').textContent = `Mark ${eventModel.event.title} as completed? Students will be able to download their certificates.`;
      completeEventModal.show();
    }
  };

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      filterButtons.forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      activeFilter = button.dataset.filter;
      renderOrganizerEvents(
        allEventModels.filter((item) => matchesOrganizerFilter(item, activeFilter)),
        actionHandlers
      );
    });
  });

  showLoadingSpinner('organizerDashboardLoader', 'Loading your events…');

  let orgRefreshTimer = null;

  onSnapshot(query(collection(db, 'events'), where('organizerId', '==', user.uid)), (snapshot) => {
    const events = snapshot.docs
      .map((item) => normalizeEvent({ id: item.id, ...item.data() }))
      .sort((left, right) => getEventDateValue(left) - getEventDateValue(right));

    if (orgRefreshTimer) clearTimeout(orgRefreshTimer);
    orgRefreshTimer = setTimeout(async () => {
      orgRefreshTimer = null;

      allEventModels = await Promise.all(
        events.map(async (event) => ({
          event,
          metrics: await getOrganizerEventMetrics(event.id)
        }))
      );

      const totalRegistered = allEventModels.reduce((sum, item) => sum + item.metrics.registered, 0);
      const totalWaitlisted = allEventModels.reduce((sum, item) => sum + item.metrics.waitlisted, 0);
      const totalAttended = allEventModels.reduce((sum, item) => sum + item.metrics.attended, 0);

      document.getElementById('orgStatEvents').textContent = allEventModels.length;
      document.getElementById('orgStatRegistered').textContent = totalRegistered;
      document.getElementById('orgStatAttended').textContent = totalAttended;
      document.getElementById('orgStatWaitlist').textContent = totalWaitlisted;

      renderOrganizerPanels(allEventModels);
      renderOrganizerEvents(
        allEventModels.filter((item) => matchesOrganizerFilter(item, activeFilter)),
        actionHandlers
      );

      const selectedEvent = findSelectedManageEvent();
      if (selectedEvent) {
        await populateManageModal(selectedEvent);
      }

      hideLoadingSpinner('organizerDashboardLoader', '');
    }, 200);
  });
}
