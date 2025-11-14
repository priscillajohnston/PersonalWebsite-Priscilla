(() => {
  const COOKIE_NAME = 'site_theme';
  const LEGACY_COOKIE_NAMES = ['theme_preference'];
  const THEMES = new Set(['light', 'dark']);
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

  function init() {
    const html = document.documentElement;
    const toggles = Array.from(document.querySelectorAll('[data-theme-toggle]'));
    if (!html) {
      return;
    }

    const { theme: storedTheme, source: storedSource } = readStoredTheme();
    if (storedTheme && storedSource && storedSource !== COOKIE_NAME && THEMES.has(storedTheme)) {
      migrateLegacyThemeCookie(storedSource, storedTheme);
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = THEMES.has(storedTheme)
      ? storedTheme
      : prefersDark
        ? 'dark'
        : 'light';

    applyTheme(html, toggles, initialTheme, { persist: false });

    toggles.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      button.addEventListener('click', () => {
        const current = html.dataset.theme === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(html, toggles, next, { persist: true });
      });
    });

    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemChange = (event) => {
        const { theme } = readStoredTheme();
        const hasStoredPreference = THEMES.has(theme);
        if (!hasStoredPreference) {
          applyTheme(html, toggles, event.matches ? 'dark' : 'light', { persist: false });
        }
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleSystemChange);
      }
    }
  }

  function applyTheme(html, toggles, theme, { persist }) {
    const normalized = THEMES.has(theme) ? theme : 'light';
    html.dataset.theme = normalized;
    updateToggleButtons(toggles, normalized);
    if (persist) {
      writeThemeCookie(normalized);
    }
  }

  function updateToggleButtons(toggles, theme) {
    toggles.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const isDark = theme === 'dark';
      button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      button.dataset.themeState = theme;
      button.innerHTML = [
        `<span aria-hidden="true" class="theme-toggle-icon">${isDark ? '☾' : '☀'}</span>`,
        `<span class="theme-toggle-label">${isDark ? 'Dark' : 'Light'} mode</span>`,
      ].join('');
    });
  }

  function readStoredTheme() {
    const cookieString = document.cookie || '';
    if (!cookieString) {
      return { theme: null, source: null };
    }
    const cookies = cookieString.split(';').map((entry) => entry.trim());
    const candidates = [COOKIE_NAME, ...LEGACY_COOKIE_NAMES];
    for (const name of candidates) {
      const prefix = `${name}=`;
      const entry = cookies.find((value) => value.startsWith(prefix));
      if (entry) {
        const raw = entry.substring(prefix.length);
        if (raw) {
          try {
            return { theme: decodeURIComponent(raw), source: name };
          } catch (error) {
            return { theme: raw, source: name };
          }
        }
      }
    }
    return { theme: null, source: null };
  }

  function migrateLegacyThemeCookie(oldName, theme) {
    writeThemeCookie(theme);
    clearCookie(oldName);
  }

  function writeThemeCookie(theme) {
    try {
      const value = encodeURIComponent(theme);
      document.cookie = `${COOKIE_NAME}=${value};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
    } catch (error) {
      console.warn('Failed to persist theme preference cookie', error);
    }
  }

  function clearCookie(name) {
    try {
      document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
    } catch (error) {
      console.warn(`Failed to clear cookie ${name}`, error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

