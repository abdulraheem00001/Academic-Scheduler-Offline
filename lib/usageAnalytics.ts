import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { analytics } from '@/config/firebase';

const APP_INSTALLED_KEY = 'unischedule_app_installed_logged';
const APP_OPEN_COUNT_KEY = 'unischedule_app_open_count';

async function safeLogEvent(eventName: string, params?: Record<string, string | number | boolean>): Promise<void> {
  try {
    await analytics.logEvent(eventName, params ?? {});
  } catch {}
}

async function logAppInstalledOnce(): Promise<void> {
  const alreadyLogged = await AsyncStorage.getItem(APP_INSTALLED_KEY);
  if (alreadyLogged === '1') return;
  await safeLogEvent('app_installed');
  await AsyncStorage.setItem(APP_INSTALLED_KEY, '1');
}

async function logAppOpenedAndCount(): Promise<void> {
  await safeLogEvent('app_opened');

  const raw = await AsyncStorage.getItem(APP_OPEN_COUNT_KEY);
  const current = raw ? parseInt(raw, 10) : 0;
  const next = Number.isFinite(current) ? current + 1 : 1;
  await AsyncStorage.setItem(APP_OPEN_COUNT_KEY, String(next));
  await safeLogEvent('app_opened_count', { count: next });
}

export function setupAppUsageAnalytics(): () => void {
  if (Platform.OS === 'web') return () => {};

  let sessionStartMs = Date.now();
  let appState: AppStateStatus = AppState.currentState;

  void (async () => {
    await logAppInstalledOnce();
    await logAppOpenedAndCount();
    sessionStartMs = Date.now();
  })();

  const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (appState === 'active' && (nextState === 'background' || nextState === 'inactive')) {
      const durationSeconds = Math.max(0, Math.round((Date.now() - sessionStartMs) / 1000));
      void safeLogEvent('app_session', { duration_seconds: durationSeconds });
    }
    if ((appState === 'background' || appState === 'inactive') && nextState === 'active') {
      sessionStartMs = Date.now();
    }
    appState = nextState;
  });

  return () => sub.remove();
}

export function useTabScreenViewAnalytics(screenName: string, screenClass: string): void {
  const navigation = useNavigation();

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void safeLogEvent('screen_view', {
        screen_name: screenName,
        screen_class: screenClass,
      });
    });
    return unsubscribe;
  }, [navigation, screenClass, screenName]);
}
