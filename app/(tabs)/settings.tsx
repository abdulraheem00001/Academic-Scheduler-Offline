import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSchedule } from '@/context/ScheduleContext';
import type { AlertMode } from '@/context/ScheduleContext';
import Colors from '@/constants/colors';
import { useTabScreenViewAnalytics } from '@/lib/usageAnalytics';

const LEAD_TIMES = [5, 10, 15, 20, 30];
const ROUTINE_KEY = 'unischedule_daily_routine';
const ALERT_MODE_OPTIONS: AlertMode[] = ['none', 'start', 'end', 'both'];

const ALERT_MODE_LABEL: Record<AlertMode, string> = {
  none: 'None',
  start: 'Start',
  end: 'End',
  both: 'Both',
};

type StoredRoutine = {
  title?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  reminderEnabled?: number;
  reminderIds?: string[];
  reminderId?: string | null;
};

function getRoutineNotificationIds(item: StoredRoutine): string[] {
  if (Array.isArray(item.reminderIds) && item.reminderIds.length > 0) return item.reminderIds;
  if (item.reminderId) return [item.reminderId];
  return [];
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getDayNumber(day: string): number {
  const map: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  return map[day] ?? -1;
}

function getWeeklyTrigger(day: string, time: string, offsetMins = 0): Notifications.CalendarTriggerInput | null {
  const dayNum = getDayNumber(day);
  if (dayNum < 0) return null;
  let mins = timeToMinutes(time) - offsetMins;
  let triggerDay = dayNum;
  while (mins < 0) {
    mins += 24 * 60;
    triggerDay = (triggerDay + 6) % 7;
  }
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  const weekday = triggerDay === 0 ? 1 : triggerDay + 1;
  return { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, weekday, hour, minute, repeats: true };
}

async function ensureNotificationPermission(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const req = await Notifications.requestPermissionsAsync();
  return !!(req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

async function scheduleRoutineForMode(item: StoredRoutine, mode: AlertMode, leadMins: number): Promise<string[]> {
  if (!item.day || !item.startTime || !item.endTime) return [];
  const title = item.title ?? 'Routine';
  const body = `${item.day} ${item.startTime} - ${item.endTime}${item.notes ? ` • ${item.notes}` : ''}`;
  const ids: string[] = [];

  if (leadMins > 0) {
    const trigger = getWeeklyTrigger(item.day, item.startTime, Math.max(0, leadMins));
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: `Upcoming routine: ${title}`, body, sound: 'default' },
        trigger,
      });
      ids.push(id);
    }
  }

  if (mode === 'start' || mode === 'both') {
    const trigger = getWeeklyTrigger(item.day, item.startTime, 0);
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: `Start now: ${title}`, body, sound: 'default' },
        trigger,
      });
      ids.push(id);
    }
  }
  if (mode === 'end' || mode === 'both') {
    const trigger = getWeeklyTrigger(item.day, item.endTime);
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: `Ended: ${title}`, body, sound: 'default' },
        trigger,
      });
      ids.push(id);
    }
  }
  return ids;
}

export default function SettingsScreen() {
  useTabScreenViewAnalytics('Setting', 'SettingsScreen');
  const insets = useSafeAreaInsets();
  const {
    reminderLeadTime,
    setReminderLeadTime,
    lectureAlertMode,
    routineAlertMode,
    setLectureAlertMode,
    setRoutineAlertMode,
    clearAllLectures,
  } = useSchedule();
  const [saving, setSaving] = useState(false);
  const [savingModes, setSavingModes] = useState(false);
  const [clearingLectures, setClearingLectures] = useState(false);
  const [clearingRoutine, setClearingRoutine] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 + 34 : insets.bottom + 80;

  const handleLeadTime = async (mins: number) => {
    if (mins === reminderLeadTime) return;
    Haptics.selectionAsync();
    setSaving(true);
    try {
      await setReminderLeadTime(mins);
      const raw = await AsyncStorage.getItem(ROUTINE_KEY);
      const routines: StoredRoutine[] = raw ? JSON.parse(raw) : [];
      const hasPerms = routineAlertMode === 'none' ? true : await ensureNotificationPermission();
      const updated: StoredRoutine[] = [];
      for (const item of routines) {
        const ids = getRoutineNotificationIds(item);
        await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
        if (!item.reminderEnabled || !hasPerms || routineAlertMode === 'none') {
          updated.push({ ...item, reminderIds: [], reminderId: null });
          continue;
        }
        const scheduled = await scheduleRoutineForMode(item, routineAlertMode, mins);
        updated.push({
          ...item,
          reminderIds: scheduled,
          reminderId: scheduled[0] ?? null,
          reminderEnabled: scheduled.length > 0 ? 1 : 0,
        });
      }
      await AsyncStorage.setItem(ROUTINE_KEY, JSON.stringify(updated));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllLectures = () => {
    Alert.alert(
      'Delete All Lectures',
      'This will remove all lectures from your schedule. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setClearingLectures(true);
            try {
              await clearAllLectures();
            } finally {
              setClearingLectures(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllRoutine = () => {
    Alert.alert(
      'Delete All Routine',
      'This will remove all routine items and their reminders. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setClearingRoutine(true);
            try {
              const raw = await AsyncStorage.getItem(ROUTINE_KEY);
              const routines: StoredRoutine[] = raw ? JSON.parse(raw) : [];
              const ids = routines.flatMap(getRoutineNotificationIds);
              await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
              await AsyncStorage.setItem(ROUTINE_KEY, '[]');
            } finally {
              setClearingRoutine(false);
            }
          },
        },
      ]
    );
  };

  const handleLectureMode = async (mode: AlertMode) => {
    if (mode === lectureAlertMode) return;
    Haptics.selectionAsync();
    setSavingModes(true);
    try {
      await setLectureAlertMode(mode);
    } finally {
      setSavingModes(false);
    }
  };

  const handleRoutineMode = async (mode: AlertMode) => {
    if (mode === routineAlertMode) return;
    Haptics.selectionAsync();
    setSavingModes(true);
    try {
      await setRoutineAlertMode(mode);

      const raw = await AsyncStorage.getItem(ROUTINE_KEY);
      const routines: StoredRoutine[] = raw ? JSON.parse(raw) : [];
      const hasPerms = mode === 'none' ? true : await ensureNotificationPermission();
      const updated: StoredRoutine[] = [];

      for (const item of routines) {
        const ids = getRoutineNotificationIds(item);
        await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));

        if (!item.reminderEnabled || !hasPerms || mode === 'none') {
          updated.push({ ...item, reminderIds: [], reminderId: null });
          continue;
        }

        const scheduled = await scheduleRoutineForMode(item, mode, reminderLeadTime);
        updated.push({
          ...item,
          reminderIds: scheduled,
          reminderId: scheduled[0] ?? null,
          reminderEnabled: scheduled.length > 0 ? 1 : 0,
        });
      }

      await AsyncStorage.setItem(ROUTINE_KEY, JSON.stringify(updated));
    } finally {
      setSavingModes(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="notifications" size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Reminder Lead Time</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Get notified this many minutes before each lecture starts.
          </Text>
          <View style={styles.pillRow}>
            {LEAD_TIMES.map(mins => (
              <TouchableOpacity
                key={mins}
                style={[styles.pill, reminderLeadTime === mins && styles.pillSelected]}
                onPress={() => handleLeadTime(mins)}
                disabled={saving}
              >
                <Text style={[styles.pillText, reminderLeadTime === mins && styles.pillTextSelected]}>
                  {mins} min
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="school-outline" size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Lecture Alerts</Text>
          </View>
          <Text style={styles.sectionDesc}>Choose when lecture notifications should be sent.</Text>
          <View style={styles.pillRow}>
            {ALERT_MODE_OPTIONS.map(mode => (
              <TouchableOpacity
                key={`lecture-${mode}`}
                style={[styles.pill, lectureAlertMode === mode && styles.pillSelected]}
                onPress={() => handleLectureMode(mode)}
                disabled={savingModes}
              >
                <Text style={[styles.pillText, lectureAlertMode === mode && styles.pillTextSelected]}>
                  {ALERT_MODE_LABEL[mode]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="list-outline" size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>Routine Alerts</Text>
          </View>
          <Text style={styles.sectionDesc}>Choose when routine notifications should be sent.</Text>
          <View style={styles.pillRow}>
            {ALERT_MODE_OPTIONS.map(mode => (
              <TouchableOpacity
                key={`routine-${mode}`}
                style={[styles.pill, routineAlertMode === mode && styles.pillSelected]}
                onPress={() => handleRoutineMode(mode)}
                disabled={savingModes}
              >
                <Text style={[styles.pillText, routineAlertMode === mode && styles.pillTextSelected]}>
                  {ALERT_MODE_LABEL[mode]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.accent} />
          <Text style={styles.infoText}>
            Notifications only work when the app has notification permissions granted. 
            Reminders are scheduled weekly based on your lecture day and time.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="school" size={16} color={Colors.primary} />
            <Text style={styles.sectionTitle}>About UniSchedule</Text>
          </View>
          <View style={styles.aboutCard}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>4.0.0</Text>
            </View>
            <View style={[styles.aboutRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.aboutLabel}>Storage</Text>
              <Text style={styles.aboutValue}>Local</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
            <Text style={styles.sectionTitle}>Danger Zone</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Permanently remove all lectures or all routine items.
          </Text>

          <TouchableOpacity
            style={[styles.dangerBtn, (clearingLectures || clearingRoutine) && styles.dangerBtnDisabled]}
            onPress={handleDeleteAllLectures}
            disabled={clearingLectures || clearingRoutine}
          >
            <Ionicons name="calendar-clear-outline" size={16} color={Colors.danger} />
            <Text style={styles.dangerBtnText}>
              {clearingLectures ? 'Deleting Lectures...' : 'Delete All Lectures'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerBtn, (clearingLectures || clearingRoutine) && styles.dangerBtnDisabled]}
            onPress={handleDeleteAllRoutine}
            disabled={clearingLectures || clearingRoutine}
          >
            <Ionicons name="list-outline" size={16} color={Colors.danger} />
            <Text style={styles.dangerBtnText}>
              {clearingRoutine ? 'Deleting Routine...' : 'Delete All Routine'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerText}>Developed by Abdul Raheem</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: Colors.text,
  },
  sectionDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 19,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  pill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    flex: 1,
    alignItems: 'center',
  },
  pillSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: Colors.textSecondary,
  },
  pillTextSelected: {
    color: Colors.bg,
  },
  infoCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(74,144,217,0.08)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.2)',
    marginBottom: 28,
    alignItems: 'flex-start',
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 19,
  },
  aboutCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  aboutLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
  },
  aboutValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: Colors.text,
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dangerDim,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  dangerBtnDisabled: {
    opacity: 0.55,
  },
  dangerBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: Colors.danger,
  },
  footerText: {
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 8,
  },
});
