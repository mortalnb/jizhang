import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aurora.bookkeeper',
  appName: '记账',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  webDir: 'dist'
};

export default config;
