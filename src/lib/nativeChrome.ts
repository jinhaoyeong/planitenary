import { AppChrome } from './appChromePlugin';

type AppTheme = 'light' | 'dark';

const LIGHT_CHROME = '#FAF7F2';
const DARK_CHROME = '#14110F';

function upsertMeta(selector: string, attributes: Record<string, string>) {
  const head = document.head;
  if (!head) return;

  let meta = head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    head.appendChild(meta);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    meta?.setAttribute(key, value);
  });
}

function paintDocumentChrome(theme: AppTheme) {
  const themeColor = theme === 'dark' ? DARK_CHROME : LIGHT_CHROME;
  const root = document.documentElement;

  root.style.backgroundColor = themeColor;
  root.style.colorScheme = theme;
  if (document.body) {
    document.body.style.backgroundColor = themeColor;
  }

  const appRoot = document.getElementById('root');
  if (appRoot) {
    appRoot.style.backgroundColor = themeColor;
    appRoot.style.minHeight = '100dvh';
  }
}

/** Keep browser / PWA chrome in sync with the in-app theme. */
export function syncWebChrome(theme: AppTheme) {
  const themeColor = theme === 'dark' ? DARK_CHROME : LIGHT_CHROME;

  paintDocumentChrome(theme);

  // Recreate theme-color so Android Chrome / installed PWAs pick up the
  // change immediately instead of waiting for a cold start.
  document.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.remove());
  upsertMeta('meta#theme-color', {
    id: 'theme-color',
    name: 'theme-color',
    content: themeColor,
  });
  // Cover both schemes so browsers that match media queries update instantly.
  upsertMeta('meta#theme-color-light', {
    id: 'theme-color-light',
    name: 'theme-color',
    media: '(prefers-color-scheme: light)',
    content: themeColor,
  });
  upsertMeta('meta#theme-color-dark', {
    id: 'theme-color-dark',
    name: 'theme-color',
    media: '(prefers-color-scheme: dark)',
    content: themeColor,
  });

  upsertMeta('meta[name="apple-mobile-web-app-status-bar-style"]', {
    id: 'apple-status-bar',
    name: 'apple-mobile-web-app-status-bar-style',
    content: theme === 'dark' ? 'black-translucent' : 'default',
  });

  upsertMeta('meta[name="color-scheme"]', {
    name: 'color-scheme',
    content: theme,
  });
}

/**
 * Apply theme classes + chrome immediately (call from toggle, not only effects).
 */
export function applyThemeClass(theme: AppTheme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.dataset.theme = theme;
  paintDocumentChrome(theme);
}

/**
 * Update native Capacitor system bars when the theme toggles.
 * Uses Cap 8 SystemBars for icon contrast + local AppChrome for edge-to-edge paint.
 */
export async function syncNativeStatusBar(theme: AppTheme) {
  try {
    const { Capacitor, SystemBars, SystemBarsStyle } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    // Cap 8 built-in system bars — updates status + navigation icon contrast live.
    await SystemBars.setStyle({
      style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    });

    // Paint decor / transparent bars so Android 15+ is not left with black gaps.
    try {
      await AppChrome.sync({ theme });
    } catch (error) {
      console.warn('AppChrome sync skipped:', error);
    }

    // Keep legacy StatusBar style in sync for shells that still honor it.
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({
        style: theme === 'dark' ? Style.Dark : Style.Light,
      });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({
          color: theme === 'dark' ? DARK_CHROME : LIGHT_CHROME,
        }).catch(() => undefined);
      }
    } catch {
      // Optional on web / older shells.
    }
  } catch (error) {
    console.warn('Native status bar sync skipped:', error);
  }
}

export async function syncAppChrome(theme: AppTheme) {
  applyThemeClass(theme);
  syncWebChrome(theme);
  await syncNativeStatusBar(theme);
}
