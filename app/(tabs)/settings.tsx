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
import Colors from '@/constants/colors';

const LEAD_TIMES = [5, 10, 15, 20, 30];
const ROUTINE_KEY = 'unischedule_daily_routine';

type StoredRoutine = {
  reminderIds?: string[];
  reminderId?: string | null;
};

function getRoutineNotificationIds(item: StoredRoutine): string[] {
  if (Array.isArray(item.reminderIds) && item.reminderIds.length > 0) return item.reminderIds;
  if (item.reminderId) return [item.reminderId];
  return [];
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { reminderLeadTime, setReminderLeadTime, clearAllLectures } = useSchedule();
  const [saving, setSaving] = useState(false);
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
              <Text style={styles.aboutValue}>1.0.0</Text>
            </View>
            <View style={[styles.aboutRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.aboutLabel}>Storage</Text>
              <Text style={styles.aboutValue}>Local SQLite (offline)</Text>
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
});
