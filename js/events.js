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
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { auth, db, storage } from './firebase-config.js';
import { checkAuth, fetchUserProfile, signOutUser } from './auth.js';
import { initScanner, stopScanner } from './attendance.js';
import { promoteFromWaitlist, registerStudent } from './registration.js';
import {
  formatDate,
  formatShortDate,
  getCountdown,
  getInitials,
  getQueryParam,
  getSeatStatus,
  hasCustomPoster,
  hideLoadingSpinner,
  showLoadingSpinner,
  showToast,
  validateEmail,
  validatePhone
} from './utils.js';

let eventsCountdownTimer = null;
let detailCountdownTimer = null;
const MAX_POSTER_SIZE_BYTES = 5 * 1024 * 1024;
const VALID_POSTER_TYPES = ['image/jpeg', 'image/png'];

const fallbackEvents = [
  {
    id: 'sample-tech-summit',
    eventId: 'sample-tech-summit',
    title: 'BuildSprint AI Hackathon',
    description: 'Ship an AI-first product, present it to mentors, and compete for prizes in a fast-paced campus hackathon.',
    category: 'Hackathon',
    date: new Date('2026-03-28T15:00:00'),
    venue: 'Innovation Lab, Block C',
    location: 'Bengaluru',
    format: 'Hybrid',
    seatCap: 60,
    registeredCount: 48,
    posterUrl: 'assets/images/hero.png',
    organizerId: 'sample-organizer-1',
    organizerName: 'Campus Organizer',
    regDeadline: new Date('2026-03-26T23:00:00'),
    teamSize: 4,
    tracks: ['AI', 'Product', 'Frontend'],
    eligibility: ['Undergraduate', 'Postgraduate'],
    timeline: 'Round 1: Idea submission\nRound 2: Prototype build\nRound 3: Final demo day',
    prizes: 'Winner: INR 40,000\nRunner-up: INR 20,000\nSpecial mention: Internship interviews',
    faqs: 'Teams can have up to four members. The final showcase is on campus for shortlisted teams.',
    status: 'Upcoming'
  },
  {
    id: 'sample-case-comp',
    eventId: 'sample-case-comp',
    title: 'MarketPulse Case Competition',
    description: 'Solve a live growth challenge, submit a deck, and pitch your recommendations to a mixed industry panel.',
    category: 'Competition',
    date: new Date('2026-03-30T11:00:00'),
    venue: 'Management Auditorium',
    location: 'Pune',
    format: 'Offline',
    seatCap: 90,
    registeredCount: 52,
    posterUrl: 'assets/images/hero.png',
    organizerId: 'sample-organizer-2',
    organizerName: 'Business Club',
    regDeadline: new Date('2026-03-27T21:00:00'),
    teamSize: 4,
    tracks: ['Marketing', 'Strategy'],
    eligibility: ['MBA', 'Engineering Students'],
    timeline: 'Round 1: Quiz\nRound 2: Deck submission\nRound 3: Final presentation',
    prizes: 'Winner: INR 25,000\nRunner-up: INR 12,000',
    status: 'Upcoming'
  },
  {
    id: 'sample-product-internship',
    eventId: 'sample-product-internship',
    title: 'Campus Product Internship Drive',
    description: 'Apply for a shortlisting round, learn about the role, and unlock interviews for a summer product internship.',
    category: 'Internship',
    date: new Date('2026-04-02T14:00:00'),
    venue: 'Career Center',
    location: 'Remote',
    format: 'Online',
    seatCap: 180,
    registeredCount: 133,
    posterUrl: 'assets/images/hero.png',
    organizerId: 'sample-organizer-3',
    organizerName: 'Career Cell',
    regDeadline: new Date('2026-03-31T18:00:00'),
    teamSize: 1,
    tracks: ['Product', 'Analytics'],
    eligibility: ['Final Year', 'Recent Graduates'],
    timeline: 'Stage 1: Profile screening\nStage 2: Product assessment\nStage 3: Interview shortlist',
    prizes: 'Internship stipend and pre-placement interview opportunities.',
    status: 'Upcoming'
  },
  {
    id: 'sample-design-lab',
    eventId: 'sample-design-lab',
    title: 'Design Sprint Lab',
    description: 'A hands-on workshop for UI, prototyping, and quick critique rounds with mentor feedback.',
    category: 'Workshop',
    date: new Date('2026-03-30T11:00:00'),
    venue: 'Innovation Studio',
    location: 'Delhi',
    format: 'Offline',
    seatCap: 40,
    registeredCount: 18,
    posterUrl: 'assets/images/hero.png',
    organizerId: 'sample-organizer-1',
    organizerName: 'Design Club',
    regDeadline: new Date('2026-03-29T17:00:00'),
    teamSize: 1,
    tracks: ['UI/UX', 'Prototyping'],
    eligibility: ['All'],
    timeline: 'Live critique circles and rapid redesign rounds through the day.',
    prizes: 'Certificate and portfolio review slots.',
    status: 'Upcoming'
  }
];

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
    category: item.category || 'Other',
    format: getNormalizedFormat(item),
    location: getNormalizedLocation(item),
    teamSize: getNormalizedTeamSize(item),
    tracks: splitCommaValues(item.tracks),
    eligibility: splitCommaValues(item.eligibility)
  };
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

async function uploadEventPoster(eventId, file) {
  const extension = file.type === 'image/png' ? 'png' : 'jpg';
  const posterRef = storageRef(storage, `event-posters/${auth.currentUser.uid}/${eventId}.${extension}`);
  await uploadBytes(posterRef, file, {
    contentType: file.type,
    cacheControl: 'public,max-age=3600'
  });
  return getDownloadURL(posterRef);
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
  if (typeof event?.date?.toDate === 'function') {
    return event.date.toDate();
  }
  return new Date(event?.date);
}

function formatTimeValue(timestamp) {
  const date = typeof timestamp?.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
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
  return `${formatShortDate(event.date)}  •  ${event.venue}  •  ${getNormalizedFormat(event)}`;
}

function renderCountdownChip(element, dateValue) {
  const countdown = getCountdown(dateValue);
  if (countdown.isUrgent) {
    element.classList.add('urgent');
    element.textContent = `🔴 Starts in ${countdown.hours} hrs ${countdown.minutes} mins`;
    return;
  }
  element.classList.remove('urgent');
  element.textContent = `Starts in ${countdown.days}d ${countdown.hours}h ${countdown.minutes}m`;
}

function syncEventsCountdowns() {
  document.querySelectorAll('.countdown-chip[data-event-date]').forEach((chip) => {
    renderCountdownChip(chip, chip.dataset.eventDate);
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
    const progressFill = fragment.querySelector('.seat-progress-fill');
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
    const countdownChip = fragment.querySelector('.countdown-chip');
    const seatInfo = fragment.querySelector('.info-seats');
    const seatStatus = updateSeatUI(event.registeredCount, event.seatCap);

    card.style.animationDelay = `${index * 80}ms`;
    poster.src = event.posterUrl || 'assets/images/hero.png';
    title.textContent = event.title;
    meta.textContent = buildMetaLine(event);
    summary.textContent = event.description;
    progressFill.style.width = `${seatStatus.usedPercent}%`;
    progressFill.className = `seat-progress-fill ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
    progressCopy.textContent = `${event.registeredCount} / ${event.seatCap} registrations`;
    seatBadge.textContent = seatStatus.label;
    seatBadge.className = `seat-badge ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
    categoryBadge.textContent = event.category;
    formatBadge.textContent = getNormalizedFormat(event);
    locationChip.innerHTML = `<strong>Location</strong> ${getNormalizedLocation(event)}`;
    teamChip.innerHTML = `<strong>Participation</strong> ${getParticipationLabel(event)}`;
    const trackHighlight = getTrackHighlight(event);
    if (trackHighlight) {
      trackChip.innerHTML = `<strong>Track</strong> ${trackHighlight}`;
      trackChip.classList.remove('d-none');
    } else {
      trackChip.classList.add('d-none');
    }
    const deadlineValue = event.regDeadline ? formatDate(event.regDeadline) : `Closes on ${formatShortDate(event.date)}`;
    deadlineCopy.textContent = event.regDeadline ? `Registration deadline: ${deadlineValue}` : `Opens until the event begins`;
    seatInfo.textContent = `${event.registeredCount} / ${event.seatCap} registrations`;
    detailsButton.href = `event-detail.html?id=${event.id}`;
    countdownChip.dataset.eventDate = getEventDateValue(event).toISOString();
    renderCountdownChip(countdownChip, countdownChip.dataset.eventDate);
    grid.appendChild(fragment);
  });

  eventsCountdownTimer = window.setInterval(syncEventsCountdowns, 1000);
}

function applySort(events, sortValue) {
  const items = [...events];
  if (sortValue === 'spots') {
    return items.sort((left, right) => (left.seatCap - left.registeredCount) - (right.seatCap - right.registeredCount));
  }
  if (sortValue === 'popular') {
    return items.sort((left, right) => right.registeredCount - left.registeredCount);
  }
  if (sortValue === 'deadline') {
    return items.sort((left, right) => {
      const leftValue = left.regDeadline ? getEventDateValue({ date: left.regDeadline }).getTime() : getEventDateValue(left).getTime();
      const rightValue = right.regDeadline ? getEventDateValue({ date: right.regDeadline }).getTime() : getEventDateValue(right).getTime();
      return leftValue - rightValue;
    });
  }
  return items.sort((left, right) => getEventDateValue(left) - getEventDateValue(right));
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
    console.warn('Using fallback events:', error);
    return filterEvents(fallbackEvents, filters);
  }
}

export async function getEventById(eventId) {
  if (!eventId) {
    return fallbackEvents[0];
  }

  try {
    const snapshot = await getDoc(doc(db, 'events', eventId));
    if (snapshot.exists()) {
      return normalizeEvent({ id: snapshot.id, ...snapshot.data() });
    }
  } catch (error) {
    console.warn('Fallback event detail:', error);
  }

  return fallbackEvents.find((item) => item.id === eventId) || fallbackEvents[0];
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
  const categoryContainer = document.getElementById('categoryPills');
  const initialQuery = getQueryParam('q') || '';
  let allEvents = [];
  let currentCategory = 'All';

  showLoadingSpinner('eventsLoader', 'Finding events near you…');
  if (searchInput) {
    searchInput.value = initialQuery;
  }

  const renderCategoryPills = () => {
    if (!categoryContainer) return;
    const categories = ['All', ...new Set(allEvents.map((event) => event.category).filter(Boolean))];
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
    const locations = ['All', ...new Set(allEvents.map((event) => getNormalizedLocation(event)).filter(Boolean))];
    locationSelect.innerHTML = locations.map((location) => `
      <option value="${location}">${location === 'All' ? 'All locations' : location}</option>
    `).join('');
    locationSelect.value = locations.includes(currentValue) ? currentValue : 'All';
  };

  const applyFilters = () => {
    const filtered = filterEvents(allEvents, {
      category: currentCategory,
      search: searchInput?.value.trim() || '',
      location: locationSelect?.value || 'All',
      format: formatSelect?.value || 'All',
      team: teamSelect?.value || 'All'
    });
    const sorted = applySort(filtered, sortSelect.value);
    renderEventCards(sorted);
    const resultMeta = document.getElementById('eventsResultMeta');
    const livePulse = document.getElementById('eventsLivePulse');
    if (resultMeta) {
      resultMeta.textContent = `${sorted.length} live opportunity${sorted.length === 1 ? '' : 'ies'} matching your filters.`;
    }
    if (livePulse) {
      const teamBasedCount = sorted.filter((event) => getNormalizedTeamSize(event) > 1).length;
      livePulse.textContent = `${teamBasedCount} team-based picks in this view`;
    }
  };

  subscribeToEvents(
    (events) => {
      allEvents = events;
      populateLocations();
      renderCategoryPills();
      applyFilters();
      hideLoadingSpinner('eventsLoader', '');
    },
    async (error) => {
      console.warn('Live events fallback:', error);
      allEvents = await getEvents();
      populateLocations();
      renderCategoryPills();
      applyFilters();
      hideLoadingSpinner('eventsLoader', '');
    }
  );

  searchInput?.addEventListener('keyup', applyFilters);
  sortSelect?.addEventListener('change', applyFilters);
  locationSelect?.addEventListener('change', applyFilters);
  formatSelect?.addEventListener('change', applyFilters);
  teamSelect?.addEventListener('change', applyFilters);
}

function populateDetailCountdown(dateValue) {
  const countdownPanel = document.getElementById('detailCountdown');
  const countdown = getCountdown(dateValue);
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
  const modalElement = document.getElementById('registrationModal');
  const registrationModal = new bootstrap.Modal(modalElement);
  const registerButton = document.getElementById('registerButton');
  const waitlistButton = document.getElementById('waitlistButton');
  const registrationForm = document.getElementById('registrationForm');
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
  let event = await getEventById(eventId);
  let liveRegisteredCount = event.registeredCount || 0;

  showLoadingSpinner('eventDetailLoader', 'Loading event details…');

  const renderEvent = async () => {
    document.getElementById('detailPoster').src = event.posterUrl || 'assets/images/hero.png';
    document.getElementById('detailCategory').textContent = event.category;
    document.getElementById('detailTitle').textContent = event.title;
    document.getElementById('detailDescription').textContent = event.description;
    document.getElementById('detailDate').textContent = formatShortDate(event.date);
    document.getElementById('detailTime').textContent = formatTimeValue(getEventDateValue(event));
    document.getElementById('detailVenue').textContent = event.venue;
    document.getElementById('detailCategoryText').textContent = event.category;
    document.getElementById('detailDeadline').textContent = event.regDeadline ? formatDate(event.regDeadline) : 'Until the event begins';
    document.getElementById('detailFormat').textContent = getNormalizedFormat(event);
    document.getElementById('detailLocation').textContent = getNormalizedLocation(event);
    document.getElementById('detailParticipation').textContent = getParticipationLabel(event);
    document.getElementById('organizerName').textContent = event.organizerName || 'Campus Organizer';
    document.getElementById('organizerAvatar').textContent = getInitials(event.organizerName || 'Campus Organizer');
    document.getElementById('registrationModalTitle').textContent = `Register for ${event.title}`;
    populateDetailCountdown(getEventDateValue(event));

    const dynamicMetaContent = [];
    if (event.teamSize) dynamicMetaContent.push(buildDetailChip('Team', getParticipationLabel(event)));
    if (event.regDeadline) dynamicMetaContent.push(buildDetailChip('Deadline', formatShortDate(event.regDeadline)));
    if (event.tracks && event.tracks.length) {
      event.tracks.forEach(track => dynamicMetaContent.push(buildDetailChip('Track', track)));
    }
    if (event.eligibility && event.eligibility.length) {
      event.eligibility.forEach(elig => dynamicMetaContent.push(buildDetailChip('Eligibility', elig)));
    }
    
    const metaContainer = document.getElementById('detailDynamicMeta');
    if (dynamicMetaContent.length) {
      metaContainer.innerHTML = dynamicMetaContent.join('');
      metaContainer.classList.remove('d-none');
    } else {
      metaContainer.classList.add('d-none');
    }
    
    let hasExtended = false;
    const timelineEl = document.getElementById('detailTimeline');
    const prizesEl = document.getElementById('detailPrizes');
    const faqsEl = document.getElementById('detailFaqs');
    
    if (event.timeline) {
      timelineEl.textContent = event.timeline;
      document.getElementById('sectionTimelineWrapper').classList.remove('d-none');
      hasExtended = true;
    } else {
      document.getElementById('sectionTimelineWrapper').classList.add('d-none');
    }
    
    if (event.prizes) {
      prizesEl.textContent = event.prizes;
      document.getElementById('sectionPrizesWrapper').classList.remove('d-none');
      hasExtended = true;
    } else {
      document.getElementById('sectionPrizesWrapper').classList.add('d-none');
    }
    
    if (event.faqs) {
      faqsEl.textContent = event.faqs;
      document.getElementById('sectionFaqsWrapper').classList.remove('d-none');
      hasExtended = true;
    } else {
      document.getElementById('sectionFaqsWrapper').classList.add('d-none');
    }
    
    if (hasExtended) {
      document.getElementById('detailExtendedSections').classList.remove('d-none');
    } else {
      document.getElementById('detailExtendedSections').classList.add('d-none');
    }

    const teamLimit = getNormalizedTeamSize(event);
    if (teamFields && teamMemberCount && teamMembersFields) {
      if (teamLimit > 1) {
        teamFields.classList.remove('d-none');
        teamHint.textContent = `This ${event.category.toLowerCase()} supports team participation with up to ${teamLimit} members.`;
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

    clearInterval(detailCountdownTimer);
    detailCountdownTimer = window.setInterval(() => populateDetailCountdown(getEventDateValue(event)), 1000);
    hideLoadingSpinner('eventDetailLoader', '');
  };

  const syncSeatPanel = (registeredCount) => {
    const seatStatus = updateSeatUI(registeredCount, event.seatCap);
    document.getElementById('registeredCount').textContent = registeredCount;
    document.getElementById('seatCap').textContent = event.seatCap;
    document.getElementById('detailProgressFill').style.width = `${seatStatus.usedPercent}%`;
    document.getElementById('detailProgressFill').className = `seat-progress-fill ${seatStatus.colorClass === 'amber' ? 'amber' : seatStatus.colorClass === 'red' ? 'red' : ''}`.trim();
    document.getElementById('detailProgressCopy').textContent = `${registeredCount} / ${event.seatCap} registrations`;
    const badge = document.getElementById('spotsBadge');
    badge.textContent = seatStatus.label;
    badge.className = seatStatus.colorClass === 'red'
      ? 'badge badge-danger-soft'
      : seatStatus.colorClass === 'amber'
        ? 'badge badge-warning-soft'
        : 'badge badge-category';

    const isFull = registeredCount >= event.seatCap;
    document.getElementById('registrationActionWrap').classList.toggle('d-none', isFull);
    document.getElementById('fullStateWrap').classList.toggle('d-none', !isFull);
  };

  await renderEvent();
  syncSeatPanel(liveRegisteredCount);

  if (eventId) {
    onSnapshot(doc(db, 'events', eventId), async (snapshot) => {
      if (!snapshot.exists()) return;
      event = normalizeEvent({ id: snapshot.id, ...snapshot.data() });
      liveRegisteredCount = event.registeredCount ?? liveRegisteredCount;
      await renderEvent();
      syncSeatPanel(liveRegisteredCount);
    });
  }

  const openRegistrationFlow = async () => {
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
    phoneError.classList.add('d-none');
    formState.classList.remove('d-none');
    successState.classList.add('d-none');
    if (getNormalizedTeamSize(event) > 1) {
      if (!teamMemberCount.value) {
        teamMemberCount.value = String(getNormalizedTeamSize(event));
      }
      renderTeamMemberFields(teamMembersFields, Number(teamMemberCount.value));
    }
    registrationModal.show();
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
    }
  });

  modalElement?.addEventListener('hidden.bs.modal', () => {
    formState.classList.remove('d-none');
    successState.classList.add('d-none');
    registrationForm.reset();
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
    if (posterStatus) posterStatus.textContent = 'No file selected.';
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
      posterStatus.textContent = `${file.name} selected`;
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
