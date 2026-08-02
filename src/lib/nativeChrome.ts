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

/** Keep browser / PWA chrome in sync with the in-app theme. */
export function syncWebChrome(theme: AppTheme) {
  const themeColor = theme === 'dark' ? DARK_CHROME : LIGHT_CHROME;

  // Recreate theme-color so Android Chrome / installed PWAs pick up the
  // change immediately instead of waiting for a cold start.
  document.querySelectorAll('meta[name="theme-color"]').forEach((node) => node.remove());
  upsertMeta('meta#theme-color', {
    id: 'theme-color',
    name: 'theme-color',
    content: themeColor,
  });

  // iOS standalone may only honor this on next launch, but keep it correct
  // for relaunches and for any runtime-aware WebViews.
  upsertMeta('meta[name="apple-mobile-web-app-status-bar-style"]', {
    name: 'apple-mobile-web-app-status-bar-style',
    content: theme === 'dark' ? 'black' : 'default',
  });

  document.documentElement.style.backgroundColor = themeColor;
  if (document.body) {
    document.body.style.backgroundColor = themeColor;
  }
}

/**
 * Update native Capacitor status-bar icon/background colors when the theme
 * toggles. Meta tags alone do not refresh iOS/Android chrome until restart.
 */
export async function syncNativeStatusBar(theme: AppTheme) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const themeColor = theme === 'dark' ? DARK_CHROME : LIGHT_CHROME;

    // Keep the webview under the status bar so `env(safe-area-inset-top)`
    // and the themed page background continue to paint the chrome area.
    await StatusBar.setOverlaysWebView({ overlay: true });

    // Style.Dark = light icons (dark backgrounds); Style.Light = dark icons.
    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });

    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: themeColor });
    }
  } catch (error) {
    // Web builds and unsynced native shells should still run.
    console.warn('Native status bar sync skipped:', error);
  }
}

export async function syncAppChrome(theme: AppTheme) {
  syncWebChrome(theme);
  await syncNativeStatusBar(theme);
}
