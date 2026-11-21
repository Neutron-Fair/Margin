import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.coilbook.cost',
  appName: '线圈本成本核算',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#F4F2EC',
  },
};

export default config;
