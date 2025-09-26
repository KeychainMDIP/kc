import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.keychain.android',
  appName: 'MDIPAndroid',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'http',
  },
};

export default config;
