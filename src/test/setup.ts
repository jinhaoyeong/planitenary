/**
 * Shared test setup.
 *
 * Runs for every test file, including the `src/lib` suites that stay in the
 * fast `node` environment: importing the matchers only extends `expect` and
 * touches no DOM, so it costs those files nothing.
 *
 * Component tests opt into a DOM per file with a docblock, rather than the
 * whole suite paying for jsdom:
 *
 * ```ts
 * // @vitest-environment jsdom
 * ```
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library does not auto-clean without a global afterEach hook,
// and a leaked tree makes the *next* test's queries ambiguous rather than
// failing where the problem is.
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements no media queries at all, and `ThemeContext` reads
 * `prefers-color-scheme` on mount. Reporting "no match" resolves the app to its
 * light theme, which is the right default for a test: a component that behaves
 * differently in dark mode should say so explicitly rather than inherit it from
 * whatever the harness happened to report.
 *
 * Guarded on `window` so the `node`-environment suites are untouched.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
