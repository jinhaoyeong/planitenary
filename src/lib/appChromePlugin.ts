import { registerPlugin } from '@capacitor/core';

export type AppChromePlugin = {
  sync(options: { theme: 'light' | 'dark' }): Promise<void>;
};

/** Local Android plugin that paints edge-to-edge system chrome to the app theme. */
export const AppChrome = registerPlugin<AppChromePlugin>('AppChrome');
