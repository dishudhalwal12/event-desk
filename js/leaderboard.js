import {
  collection,
  getDocs,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { hideLoadingSpinner, showLoadingSpinner } from './utils.js';

function getRankLabel(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  if (index === 3) return '4️⃣';
  return index === 4 ? '5️⃣' : `${index + 1}`;
}

function getBadgeLabel(count) {
  if (count >= 16) return { label: 'Legend 🏆', className: 'badge-warning-soft' };
  if (count >= 11) return { label: 'Pro 🔥', className: 'badge-warning-soft' };
  if (count >= 7) return { label: 'Active ⚡', className: 'badge-success' };
  if (count >= 4) return { label: 'Rising 🌱', className: 'badge-category' };
  return { label: 'Starter', className: 'badge-soft' };
}

function getPreviewMeta(index) {
  if (index === 0) return 'Leading the campus streak';
  if (index === 1) return 'Close behind with strong consistency';
  if (index === 2) return 'Keeping momentum high this month';
  if (index === 3) return 'Climbing with regular check-ins';
  return 'Building a steady attendance rhythm';
}

function getPreviewRank(index) {
  return String(index + 1).padStart(2, '0');
}

function getPreviewBadgeLabel(count) {
  const { label } = getBadgeLabel(count);
  return label.replace(/[^\w\s]/g, '').trim();
}

async function hydrateLeaderboard(rawEntries) {
  if (!rawEntries.length) {
    return [];
  }

  const grouped = rawEntries.reduce((accumulator, item) => {
    const userId = item.userId;
    accumulator[userId] = (accumulator[userId] || 0) + 1;
    return accumulator;
  }, {});

  const entries = await Promise.all(
    Object.entries(grouped).map(async ([userId, count]) => {
      const fallbackName = rawEntries.find((item) => item.userId === userId)?.studentName;
      return {
        userId,
        name: fallbackName || 'Campus Legend',
        count
      };
    })
  );

  return entries.sort((left, right) => right.count - left.count).slice(0, 10);
}

export async function getLeaderboardData() {
  try {
    const attendanceSnapshot = await getDocs(collection(db, 'attendance'));
    return await hydrateLeaderboard(attendanceSnapshot.docs.map((item) => item.data()));
  } catch (error) {
    console.warn('Leaderboard unavailable:', error);
    return [];
  }
}

export async function getUserRank(userId) {
  const leaderboard = await getLeaderboardData();
  const index = leaderboard.findIndex((entry) => entry.userId === userId);
  return index >= 0 ? index + 1 : null;
}

export async function loadLeaderboardPreview(targetId) {
  const tbody = document.getElementById(targetId);
  if (!tbody) return;
  const entries = await getLeaderboardData();
  const preview = entries.slice(0, 5);

  if (!preview.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-center text-muted py-4">Verified attendance will appear here after the first check-in.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = preview.map((entry, index) => `
    <tr>
      <td><span class="leaderboard-rank-badge${index < 3 ? ' is-top' : ''}">${getPreviewRank(index)}</span></td>
      <td>
        <div class="leaderboard-person">
          <span class="leaderboard-person-name">${entry.name}</span>
          <span class="leaderboard-person-meta">${getPreviewMeta(index)}</span>
        </div>
      </td>
      <td>
        <div class="leaderboard-count-wrap">
          <strong>${entry.count}</strong>
          <span>events attended</span>
          <span class="leaderboard-score-chip">${getPreviewBadgeLabel(entry.count)}</span>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderLeaderboardEmptyState() {
  const tbody = document.getElementById('leaderboardTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted py-5">No verified attendance has been recorded yet. The leaderboard will fill itself once organizers start scanning confirmed registrations.</td>
      </tr>
    `;
  }

  const podiumEntries = [
    { id: 'podiumFirst', name: 'No attendance yet', count: 'Waiting for the first check-in' },
    { id: 'podiumSecond', name: 'No attendance yet', count: 'Waiting for the first check-in' },
    { id: 'podiumThird', name: 'No attendance yet', count: 'Waiting for the first check-in' }
  ];

  podiumEntries.forEach((entry) => {
    const root = document.getElementById(entry.id);
    if (!root) return;
    root.querySelector('.podium-name').textContent = entry.name;
    root.querySelector('.podium-count').textContent = entry.count;
  });
}

function renderLeaderboardPage(entries) {
  const tbody = document.getElementById('leaderboardTableBody');
  const template = document.getElementById('leaderboardRowTemplate');
  if (!tbody || !template) return;

  tbody.innerHTML = '';
  const activeUserId = auth.currentUser?.uid;

  if (!entries.length) {
    renderLeaderboardEmptyState();
    return;
  }

  entries.forEach((entry, index) => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector('tr');
    const badge = getBadgeLabel(entry.count);

    fragment.querySelector('.rank-cell').textContent = getRankLabel(index);
    fragment.querySelector('.name-cell').textContent = entry.name;
    fragment.querySelector('.count-cell').textContent = entry.count;
    const badgeElement = fragment.querySelector('.badge-label');
    badgeElement.textContent = badge.label;
    badgeElement.className = `badge ${badge.className} badge-label`;

    if (entry.userId === activeUserId) {
      row.style.background = '#f5f5f5';
      row.style.borderLeft = '3px solid #232323';
    }

    tbody.appendChild(fragment);
  });

  const [first, second, third] = [entries[0], entries[1], entries[2]];
  if (first) {
    document.querySelector('#podiumFirst .podium-name').textContent = first.name;
    document.querySelector('#podiumFirst .podium-count').textContent = `${first.count} events`;
  }
  if (second) {
    document.querySelector('#podiumSecond .podium-name').textContent = second.name;
    document.querySelector('#podiumSecond .podium-count').textContent = `${second.count} events`;
  }
  if (third) {
    document.querySelector('#podiumThird .podium-name').textContent = third.name;
    document.querySelector('#podiumThird .podium-count').textContent = `${third.count} events`;
  }
}

export async function initLeaderboardPage() {
  showLoadingSpinner('leaderboardLoader', 'Loading campus legends…');

  try {
    onSnapshot(
      collection(db, 'attendance'),
      async (snapshot) => {
        const entries = await hydrateLeaderboard(snapshot.docs.map((item) => item.data()));
        renderLeaderboardPage(entries);
        hideLoadingSpinner('leaderboardLoader', '');
      },
      async () => {
        const entries = await getLeaderboardData();
        renderLeaderboardPage(entries);
        hideLoadingSpinner('leaderboardLoader', '');
      }
    );
  } catch (error) {
    console.warn(error);
    const entries = await getLeaderboardData();
    renderLeaderboardPage(entries);
    hideLoadingSpinner('leaderboardLoader', '');
  }
}
