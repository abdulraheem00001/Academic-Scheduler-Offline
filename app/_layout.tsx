import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { queryClient } from '@/lib/query-client';
import { ScheduleProvider } from '@/context/ScheduleContext';
import { setupAppUsageAnalytics } from '@/lib/usageAnalytics';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification handler for all app states
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowList: true,
  }),
});

// Handle notifications when app is in background/closed
Notifications.addNotificationReceivedListener((notification) => {
  console.log('Notification received:', notification.request.content.title);
});

Notifications.addNotificationResponseReceivedListener((response) => {
  console.log('Notification response:', response.notification.request.content.title);
});

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="edit-lecture"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="import"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    const teardown = setupAppUsageAnalytics();
    return teardown;
  }, []);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ScheduleProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <StatusBar style="light" />
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </ScheduleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
