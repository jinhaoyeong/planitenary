import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blankcanvas.app',
  appName: 'Travel Handbook',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
      backgroundColor: '#FAF7F2',
    },
    SystemBars: {
      // Keep CSS safe-area insets so the web UI draws edge-to-edge under the bars.
      insetsHandling: 'css',
      style: 'LIGHT',
    },
  },
};

export default config;
