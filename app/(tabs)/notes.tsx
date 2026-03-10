import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Platform,
  Alert,
  Switch,
  Keyboard,
  Animated,
  PanResponder,
  ScrollView,
  BackHandler,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import Colors from '@/constants/colors';
import { useTabScreenViewAnalytics } from '@/lib/usageAnalytics';

type NoteEvent = {
  id: string;
  title: string;
  details: string;
  dateAt?: string | null;
  reminderEnabled: number;
  reminderIds?: string[];
};

const NOTES_KEY = 'unischedule_notes_events';

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function noteStatus(note: NoteEvent, now: Date): 'upcoming' | 'active' | 'ended' | 'unscheduled' {
  if (!note.dateAt) return 'unscheduled';
  const eventAt = new Date(note.dateAt).getTime();
  const current = now.getTime();
  if (current < eventAt) return 'upcoming';
  if (Math.abs(current - eventAt) <= 15 * 60 * 1000) return 'active';
  return 'ended';
}

function getNoteIdentifier(note: NoteEvent): string {
  return `note-${note.id}-date`;
}

async function ensureNotificationPermission(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const req = await Notifications.requestPermissionsAsync();
  return !!(req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

async function cancelNoteNotifications(note: NoteEvent): Promise<void> {
  const knownIds = [
    ...(note.reminderIds ?? []),
    getNoteIdentifier(note),
  ];
  await Promise.all(
    knownIds.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}

async function scheduleNoteNotifications(note: NoteEvent): Promise<string[] | null> {
  if (!note.dateAt) return null;
  const hasPerms = await ensureNotificationPermission();
  if (!hasPerms) return null;

  await cancelNoteNotifications(note);

  const now = Date.now();
  const eventDate = new Date(note.dateAt);
  const ids: string[] = [];

  if (eventDate.getTime() > now) {
    const id = await Notifications.scheduleNotificationAsync({
      identifier: getNoteIdentifier(note),
      content: {
        title: `Reminder: ${note.title}`,
        body: note.details || `On ${formatDateTime(note.dateAt)}`,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: eventDate,
      },
    });
    ids.push(id);
  }

  return ids.length ? ids : null;
}

function sortNotes(items: NoteEvent[]): NoteEvent[] {
  return [...items].sort((a, b) => {
    const aStart = a.dateAt ? new Date(a.dateAt).getTime() : -1;
    const bStart = b.dateAt ? new Date(b.dateAt).getTime() : -1;
    return bStart - aStart;
  });
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toTimeInput12h(d: Date): string {
  return formatHourMinute12h(d.getHours(), d.getMinutes());
}

function parseDateInput(value: string): { year: number; month: number; day: number } | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function formatHourMinute12h(hour24: number, minute: number): string {
  let hour = hour24 % 24;
  const meridiem: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

function parseTimeInput(
  value: string,
  mode: '24h' | 'ampm',
  fallbackMeridiem: 'AM' | 'PM'
): { hour: number; minute: number } | null {
  const raw = value.trim();
  if (!raw) return null;

  // 24-hour format HH:MM
  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hour = parseInt(m24[1], 10);
    const minute = parseInt(m24[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      if (mode === '24h') return { hour, minute };
      // in ampm mode with no suffix, use selected meridiem
      let h = hour;
      if (h >= 13) {
        // allow user to type 13:00 etc: treat as 24h still
        return { hour: h, minute };
      }
      if (fallbackMeridiem === 'PM' && h !== 12) h += 12;
      if (fallbackMeridiem === 'AM' && h === 12) h = 0;
      return { hour: h, minute };
    }
  }

  // 12-hour format HH:MM AM/PM
  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let hour = parseInt(m12[1], 10);
    const minute = parseInt(m12[2], 10);
    const meridiem = m12[3].toUpperCase() as 'AM' | 'PM';
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (meridiem === 'PM' && hour !== 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      return { hour, minute };
    }
  }

  return null;
}

export default function NotesScreen() {
  useTabScreenViewAnalytics('Notes', 'NotesScreen');
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [timeFormat, setTimeFormat] = useState<'24h' | 'ampm'>('24h');
  const [timeMeridiem, setTimeMeridiem] = useState<'AM' | 'PM'>('AM');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 + 24 : insets.bottom + 84;

  const persistNotes = useCallback(async (next: NoteEvent[]) => {
    const sorted = sortNotes(next);
    setNotes(sorted);
    await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(sorted));
  }, []);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await AsyncStorage.getItem(NOTES_KEY);
      const parsed: Array<Partial<NoteEvent> & { startAt?: string | null; endAt?: string }> = raw ? JSON.parse(raw) : [];
      const normalized: NoteEvent[] = parsed
        .filter(item => item && item.id && item.title)
        .map(item => ({
          id: String(item.id),
          title: String(item.title),
          details: String(item.details ?? ''),
          dateAt: item.dateAt ?? item.startAt ?? item.endAt ?? null,
          reminderEnabled: item.reminderEnabled ? 1 : 0,
          reminderIds: Array.isArray(item.reminderIds) ? item.reminderIds : [],
        }));
      setNotes(sortNotes(normalized));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setTitle('');
    setDetails('');
    setDateInput('');
    setTimeInput('');
    setTimeFormat('24h');
    setTimeMeridiem('AM');
    setReminderEnabled(true);
  }, []);

  const openAdd = useCallback(() => {
    resetForm();
    setComposerOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((note: NoteEvent) => {
    setEditingId(note.id);
    setTitle(note.title);
    setDetails(note.details);
    if (note.dateAt) {
      const dt = new Date(note.dateAt);
      setDateInput(toDateInput(dt));
      setTimeMeridiem(dt.getHours() >= 12 ? 'PM' : 'AM');
      setTimeInput(timeFormat === 'ampm' ? toTimeInput12h(dt) : toTimeInput(dt));
    } else {
      setDateInput('');
      setTimeInput('');
      setTimeMeridiem('AM');
    }
    setReminderEnabled(!!note.reminderEnabled);
    setComposerOpen(true);
  }, [timeFormat]);

  const closeComposer = useCallback(() => {
    Keyboard.dismiss();
    Animated.timing(sheetTranslateY, {
      toValue: windowHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setComposerOpen(false);
      resetForm();
    });
  }, [resetForm, sheetTranslateY, windowHeight]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          composerOpen &&
          gesture.dy > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          sheetTranslateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 1.1) {
            closeComposer();
            return;
          }
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 25,
            stiffness: 260,
            mass: 0.8,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 25,
            stiffness: 260,
            mass: 0.8,
            useNativeDriver: true,
          }).start();
        },
      }),
    [closeComposer, composerOpen, sheetTranslateY]
  );

  useEffect(() => {
    if (!composerOpen) {
      sheetTranslateY.setValue(windowHeight);
      return;
    }
    sheetTranslateY.setValue(windowHeight);
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      damping: 25,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [composerOpen, sheetTranslateY, windowHeight]);

  useEffect(() => {
    if (!composerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeComposer();
      return true;
    });
    return () => sub.remove();
  }, [closeComposer, composerOpen]);

  const saveNote = useCallback(async () => {
    const trimmedTitle = title.trim();
    const trimmedDetails = details.trim();
    const dateTrimmed = dateInput.trim();
    const timeTrimmed = timeInput.trim();
    const hasDate = dateTrimmed.length > 0;
    const hasTime = timeTrimmed.length > 0;
    const dateParsed = hasDate ? parseDateInput(dateTrimmed) : null;
    const timeParsed = hasTime ? parseTimeInput(timeTrimmed, timeFormat, timeMeridiem) : null;
    const eventDt = dateParsed && timeParsed
      ? new Date(dateParsed.year, dateParsed.month - 1, dateParsed.day, timeParsed.hour, timeParsed.minute, 0, 0)
      : null;

    if (!trimmedTitle) {
      Alert.alert('Title required', 'Please enter an event title.');
      return;
    }
    if (hasDate !== hasTime) {
      Alert.alert('Incomplete schedule', 'Fill both Date and Time, or leave both empty.');
      return;
    }
    if (hasDate && hasTime && !eventDt) {
      Alert.alert('Invalid Date/Time', 'Use Date as YYYY-MM-DD and Time as HH:MM (24-hour) or HH:MM with AM/PM.');
      return;
    }

    Haptics.selectionAsync();

    const base: NoteEvent = {
      id: editingId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: trimmedTitle,
      details: trimmedDetails,
      dateAt: eventDt ? eventDt.toISOString() : null,
      reminderEnabled: reminderEnabled ? 1 : 0,
      reminderIds: [],
    };

    if (editingId) {
      const existing = notes.find(n => n.id === editingId);
      if (existing) await cancelNoteNotifications(existing);
    }

    if (base.reminderEnabled) {
      const ids = await scheduleNoteNotifications(base);
      base.reminderIds = ids ?? [];
    }

    const next = editingId
      ? notes.map(n => (n.id === editingId ? base : n))
      : [base, ...notes];

    await persistNotes(next);
    closeComposer();
  }, [title, details, dateInput, timeInput, reminderEnabled, editingId, notes, persistNotes, closeComposer]);

  const removeNote = useCallback((note: NoteEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete Event', 'Remove this note event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelNoteNotifications(note);
          await persistNotes(notes.filter(n => n.id !== note.id));
        },
      },
    ]);
  }, [notes, persistNotes]);

  const toggleReminder = useCallback(async (note: NoteEvent, enabled: boolean) => {
    Haptics.selectionAsync();
    const updated: NoteEvent = { ...note, reminderEnabled: enabled ? 1 : 0, reminderIds: [] };
    await cancelNoteNotifications(note);
    if (enabled) {
      const ids = await scheduleNoteNotifications(updated);
      updated.reminderIds = ids ?? [];
    }
    await persistNotes(notes.map(n => (n.id === note.id ? updated : n)));
  }, [notes, persistNotes]);

  const now = new Date(nowMs);
  const upcoming = useMemo(() => notes.filter(n => noteStatus(n, now) !== 'ended'), [notes, now]);
  const past = useMemo(() => notes.filter(n => noteStatus(n, now) === 'ended'), [notes, now]);
  const ordered = useMemo(() => [...upcoming, ...past], [upcoming, past]);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Notes & Events</Text>
          <Text style={styles.subtitle}>Add note events with date/time reminders</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={22} color={Colors.bg} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : ordered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="document-text-outline" size={52} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No note events yet</Text>
          <Text style={styles.emptyText}>Tap + to add an event with date and reminders.</Text>
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10, paddingTop: 6 }}
          renderItem={({ item }) => {
            const status = noteStatus(item, now);
            const isActive = status === 'active';
            return (
              <View style={[styles.card, isActive && styles.cardActive]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <View style={styles.dateRow}>
                      <Ionicons name="time-outline" size={13} color={Colors.textMuted} />
                      <Text style={styles.metaText}>Date: {item.dateAt ? formatDateTime(item.dateAt) : 'Not set'}</Text>
                    </View>
                  </View>
                  <View style={[
                    styles.statusPill,
                    status === 'upcoming' ? styles.statusUpcoming :
                    status === 'active' ? styles.statusActive :
                    status === 'ended' ? styles.statusEnded :
                    styles.statusUnscheduled,
                  ]}>
                    <Text style={styles.statusText}>{status}</Text>
                  </View>
                </View>

                {!!item.details && <Text style={styles.details}>{item.details}</Text>}

                <View style={styles.cardFooter}>
                  <View style={styles.reminderRow}>
                    <Ionicons name="notifications-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.reminderLabel}>Reminder</Text>
                    <Switch
                      value={!!item.reminderEnabled}
                      onValueChange={v => { void toggleReminder(item, v); }}
                      trackColor={{ false: Colors.surface3, true: Colors.primaryDim }}
                      thumbColor={item.reminderEnabled ? Colors.primary : Colors.textMuted}
                      style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                    />
                  </View>
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(item)}>
                      <Ionicons name="pencil-outline" size={16} color={Colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => removeNote(item)}>
                      <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
      {composerOpen && (
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeComposer} />
          <Animated.View style={[styles.sheetContainer, { transform: [{ translateY: sheetTranslateY }] }]}>
            <KeyboardAvoidingView
              style={styles.sheetKeyboardWrap}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={[styles.sheetHeader, { paddingTop: insets.top + 8 }]}>
                <View style={styles.grabberTouchArea} {...panResponder.panHandlers}>
                  <View style={styles.grabber} />
                </View>
                <View style={styles.formHeaderRow}>
                  <Text style={styles.formTitle}>{editingId ? 'Edit Note Event' : 'Add Note Event'}</Text>
                  <TouchableOpacity onPress={closeComposer} hitSlop={8}>
                    <Ionicons name="close" size={20} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={styles.formScroll}
                contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 20 }]}
                keyboardShouldPersistTaps="handled"
              >
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Event title"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={() => Keyboard.dismiss()}
                />

                <TextInput
                  style={[styles.input, styles.detailsInput]}
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Details (optional)"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  blurOnSubmit
                />

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <TextInput
                    style={styles.input}
                    value={dateInput}
                    onChangeText={setDateInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.fieldWrap}>
                  <View style={styles.modeRow}>
                    <Text style={styles.modeLabel}>Time</Text>
                    <View style={styles.modeSwitch}>
                      <TouchableOpacity
                        style={[styles.modeChip, timeFormat === '24h' && styles.modeChipActive]}
                        onPress={() => setTimeFormat('24h')}
                      >
                        <Text style={[styles.modeChipText, timeFormat === '24h' && styles.modeChipTextActive]}>24H</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modeChip, timeFormat === 'ampm' && styles.modeChipActive]}
                        onPress={() => setTimeFormat('ampm')}
                      >
                        <Text style={[styles.modeChipText, timeFormat === 'ampm' && styles.modeChipTextActive]}>AM/PM</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TextInput
                    style={styles.input}
                    value={timeInput}
                    onChangeText={setTimeInput}
                    placeholder={timeFormat === 'ampm' ? 'HH:MM AM/PM' : 'HH:MM'}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  {timeFormat === 'ampm' && (
                    <View style={styles.timePresetRow}>
                      <TouchableOpacity
                        style={[styles.pillBtn, timeMeridiem === 'AM' && styles.togglePillSelected]}
                        onPress={() => {
                          setTimeMeridiem('AM');
                          const parsed = parseTimeInput(timeInput, 'ampm', 'AM');
                          if (parsed) {
                            setTimeInput(formatHourMinute12h(parsed.hour % 12, parsed.minute).replace(/AM|PM/, 'AM'));
                          } else {
                            setTimeInput('08:00 AM');
                          }
                        }}
                      >
                        <Text style={[styles.pillBtnText, timeMeridiem === 'AM' && styles.togglePillTextSelected]}>AM</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.pillBtn, timeMeridiem === 'PM' && styles.togglePillSelected]}
                        onPress={() => {
                          setTimeMeridiem('PM');
                          const parsed = parseTimeInput(timeInput, 'ampm', 'PM');
                          if (parsed) {
                            setTimeInput(formatHourMinute12h(parsed.hour % 12, parsed.minute).replace(/AM|PM/, 'PM'));
                          } else {
                            setTimeInput('08:00 PM');
                          }
                        }}
                      >
                        <Text style={[styles.pillBtnText, timeMeridiem === 'PM' && styles.togglePillTextSelected]}>PM</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={styles.formReminderRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="notifications-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.reminderLabel}>Reminder at date/time</Text>
                  </View>
                  <Switch
                    value={reminderEnabled}
                    onValueChange={setReminderEnabled}
                    trackColor={{ false: Colors.surface3, true: Colors.primaryDim }}
                    thumbColor={reminderEnabled ? Colors.primary : Colors.textMuted}
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                </View>

                <Text style={styles.helperText}>
                  Optional schedule: leave both Date and Time empty for unscheduled notes.
                </Text>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={closeComposer}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={() => { void saveNote(); }}>
                    <Ionicons name={editingId ? 'checkmark' : 'add'} size={18} color={Colors.bg} />
                    <Text style={styles.saveText}>{editingId ? 'Update' : 'Add'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: Colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 25,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
  emptyTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 10,
  },
  cardActive: {
    borderColor: Colors.primary,
    backgroundColor: '#131A0A',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 5,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  metaText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  statusPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusUpcoming: {
    backgroundColor: 'rgba(74,144,217,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.35)',
  },
  statusActive: {
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  statusEnded: {
    backgroundColor: 'rgba(74,85,104,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(74,85,104,0.45)',
  },
  statusUnscheduled: {
    backgroundColor: 'rgba(138,147,168,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(138,147,168,0.45)',
  },
  statusText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
    fontSize: 11,
  },
  details: {
    color: Colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reminderLabel: {
    color: Colors.textMuted,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 5,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheetContainer: {
    height: '100%',
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  sheetKeyboardWrap: {
    flex: 1,
  },
  sheetHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  grabberTouchArea: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.surface3,
  },
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  formTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  detailsInput: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  fieldWrap: {
    gap: 6,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modeLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: 8,
  },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
  },
  modeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modeChipText: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  modeChipTextActive: {
    color: Colors.bg,
  },
  timePresetRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
  },
  pillBtnText: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  togglePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
  },
  togglePillSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  togglePillText: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  togglePillTextSelected: {
    color: Colors.bg,
  },
  formReminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  helperText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  saveText: {
    color: Colors.bg,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
