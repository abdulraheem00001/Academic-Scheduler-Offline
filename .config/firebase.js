import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Keep default export for compatibility with existing imports.
const app = null;

let analyticsInstance = null;

async function getNativeAnalytics() {
  if (Platform.OS === 'web') return null;
  if (Constants.executionEnvironment === 'storeClient') return null; // Expo Go
  if (analyticsInstance) return analyticsInstance;
  try {
    const analyticsModule = require('@react-native-firebase/analytics').default;
    analyticsInstance = analyticsModule();
    return analyticsInstance;
  } catch {
    return null;
  }
}

const analytics = {
  async logEvent(eventName, params = {}) {
    const nativeAnalytics = await getNativeAnalytics();
    if (!nativeAnalytics) return;
    await nativeAnalytics.logEvent(eventName, params);
  },
};

export default app;
export { analytics };
