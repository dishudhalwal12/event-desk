(function () {
  const storageKey = 'eventdesk-theme';
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function getStoredTheme() {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return mediaQuery.matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }

  function syncThemeFromStorage() {
    const theme = getStoredTheme();
    applyTheme(theme);
    syncAllToggles(theme);
  }

  function getIconMarkup(theme) {
    const isDark = theme === 'dark';
    return isDark
      ? `
        <svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.79A9 9 0 0 1 11.21 3A7.5 7.5 0 1 0 21 12.79Z" fill="currentColor"></path>
        </svg>
      `
      : `
        <svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.25" fill="currentColor"></circle>
          <path d="M12 2.25V4.5M12 19.5V21.75M21.75 12H19.5M4.5 12H2.25M18.89 5.11L17.3 6.7M6.7 17.3L5.11 18.89M18.89 18.89L17.3 17.3M6.7 6.7L5.11 5.11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      `;
  }

  function getToggleMarkup(theme) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    return `
      <span class="theme-toggle-icon-wrap">${getIconMarkup(theme)}</span>
      <span class="visually-hidden">Switch to ${nextTheme} mode</span>
    `;
  }

  function syncToggle(toggle, theme) {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    toggle.innerHTML = getToggleMarkup(theme);
    toggle.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    toggle.setAttribute('title', `Switch to ${nextTheme} mode`);
    toggle.dataset.themeState = theme;
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
    syncAllToggles(nextTheme);
  }

  window.__eventDeskToggleTheme = toggleTheme;

  function bindToggle(toggle) {
    if (toggle.dataset.themeBound === 'true') {
      return;
    }
    toggle.dataset.themeBound = 'true';
    toggle.addEventListener('click', toggleTheme);
  }

  function syncAllToggles(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
      bindToggle(toggle);
      syncToggle(toggle, theme);
    });
  }

  function ensureFloatingToggle() {
    if (document.querySelector('[data-theme-toggle]')) {
      return;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'theme-toggle-floating';
    toggle.dataset.themeToggle = 'true';
    document.body.appendChild(toggle);
  }

  function mountToggles() {
    ensureFloatingToggle();
    syncAllToggles(document.documentElement.dataset.theme || getStoredTheme());
  }

  applyTheme(getStoredTheme());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggles);
  } else {
    mountToggles();
  }

  const handlePreferenceChange = (event) => {
    if (window.localStorage.getItem(storageKey)) {
      return;
    }
    const theme = event.matches ? 'dark' : 'light';
    applyTheme(theme);
    syncAllToggles(theme);
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handlePreferenceChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handlePreferenceChange);
  }

  window.addEventListener('pageshow', syncThemeFromStorage);
  window.addEventListener('focus', syncThemeFromStorage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncThemeFromStorage();
    }
  });
})();
