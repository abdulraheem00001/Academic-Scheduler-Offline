import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Platform,
  Alert,
  ScrollView,
  Switch,
  Modal,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { useFocusEffect } from '@react-navigation/native';
import { useSchedule } from '@/context/ScheduleContext';
import Colors from '@/constants/colors';

type RoutineItem = {
  id: string;
  title: string;
  day: string;
  startTime: string;
  endTime: string;
  notes: string;
  done: boolean;
  reminderEnabled: number;
  reminderIds?: string[];
  reminderId?: string | null;
};

type ImportedRoutine = {
  title: string;
  day: string;
  startTime: string;
  endTime: string;
  notes: string;
  done: boolean;
  reminderEnabled: number;
};

const ROUTINE_KEY = 'unischedule_daily_routine';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL: Record<string, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
  Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

function getTodayShort(): string {
  const d = new Date().getDay();
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];
}

function dayWeight(day: string): number {
  const full = DAY_FULL[day] ?? day;
  const order: Record<string, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
  };
  return order[full] ?? 8;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function validTime(t: string): boolean {
  const m = t.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function normalizeTimeInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function toFullDay(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const map: Record<string, string> = {
    mon: 'Monday', monday: 'Monday',
    tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
    fri: 'Friday', friday: 'Friday',
    sat: 'Saturday', saturday: 'Saturday',
    sun: 'Sunday', sunday: 'Sunday',
  };
  return map[raw.toLowerCase()] ?? null;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[\s_\-]/g, '');
}

function toHHMM(totalMinutes: number): string {
  const mins = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseSpreadsheetTime(value: unknown): string {
  if (value == null) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toHHMM(value.getHours() * 60 + value.getMinutes());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) {
      return toHHMM(Math.round(value * 24 * 60));
    }
    const frac = value - Math.floor(value);
    if (frac > 0) {
      return toHHMM(Math.round(frac * 24 * 60));
    }
    if (value >= 0 && value <= 23) {
      return toHHMM(Math.round(value * 60));
    }
    return '';
  }

  const raw = String(value).trim();
  if (!raw) return '';

  if (validTime(raw)) return raw;

  const asNum = Number(raw);
  if (!Number.isNaN(asNum)) {
    return parseSpreadsheetTime(asNum);
  }

  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AP]M)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2] ?? '0', 10);
    const mer = ampm[3].toUpperCase();
    if (mer === 'AM') {
      if (h === 12) h = 0;
    } else if (h < 12) {
      h += 12;
    }
    return toHHMM(h * 60 + m);
  }

  const plain = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plain) {
    const h = parseInt(plain[1], 10);
    const m = parseInt(plain[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return toHHMM(h * 60 + m);
    }
  }

  return '';
}

function parseImportedRows(rows: Array<Record<string, unknown>>): ImportedRoutine[] {
  const parsed: ImportedRoutine[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const byKey = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) byKey.set(normalizeHeader(k), v);

    const title = String(
      byKey.get('title') ??
      byKey.get('activity') ??
      byKey.get('task') ??
      ''
    ).trim();
    const day = toFullDay(byKey.get('day') ?? byKey.get('weekday'));
    const startRaw = byKey.get('starttime') ?? byKey.get('start') ?? '';
    const endRaw = byKey.get('endtime') ?? byKey.get('end') ?? '';
    const startTime = parseSpreadsheetTime(startRaw);
    const endTime = parseSpreadsheetTime(endRaw);
    const notes = String(byKey.get('notes') ?? byKey.get('note') ?? '').trim();
    const done = parseBool(byKey.get('done'));
    const reminderEnabled = parseBool(byKey.get('reminderenabled') ?? byKey.get('reminder')) ? 1 : 0;

    if (!title && !day && !startTime && !endTime) continue;
    if (!title || !day || !startTime || !endTime) {
      throw new Error(`Row ${i + 2} is missing required fields (title/day/startTime/endTime).`);
    }
    if (!validTime(startTime) || !validTime(endTime)) {
      throw new Error(`Row ${i + 2} has invalid time. Use HH:MM (24-hour).`);
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new Error(`Row ${i + 2} has endTime earlier than startTime.`);
    }

    parsed.push({ title, day, startTime, endTime, notes, done, reminderEnabled });
  }
  return parsed;
}

function isExcelLikeFilename(name: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(name);
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function sortRoutine(items: RoutineItem[]): RoutineItem[] {
  return [...items].sort((a, b) => {
    const d = dayWeight(a.day) - dayWeight(b.day);
    if (d !== 0) return d;
    return a.startTime.localeCompare(b.startTime);
  });
}

function isCurrentRoutine(item: RoutineItem, now: Date): boolean {
  const today = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  if (item.day !== today) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= timeToMinutes(item.startTime) && current < timeToMinutes(item.endTime);
}

function currentLeft(item: RoutineItem, now: Date): string {
  const current = now.getHours() * 60 + now.getMinutes();
  const diff = timeToMinutes(item.endTime) - current;
  if (diff <= 0) return 'Ending now';
  if (diff >= 60) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${diff}m left`;
}

function getDayNumber(day: string): number {
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[day] ?? -1;
}

async function ensureNotificationPermission(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  if (perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const req = await Notifications.requestPermissionsAsync();
  return !!(req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
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

function getRoutineNotificationIds(item: RoutineItem): string[] {
  if (Array.isArray(item.reminderIds) && item.reminderIds.length > 0) return item.reminderIds;
  if (item.reminderId) return [item.reminderId];
  return [];
}

async function cancelRoutineNotifications(item: RoutineItem): Promise<void> {
  const ids = getRoutineNotificationIds(item);
  await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

async function scheduleRoutineNotifications(item: RoutineItem, leadMins: number): Promise<string[] | null> {
  const hasPerms = await ensureNotificationPermission();
  if (!hasPerms) return null;

  const body = `${item.day} ${item.startTime} - ${item.endTime}${item.notes ? ` • ${item.notes}` : ''}`;
  const ids: string[] = [];

  if (leadMins > 0) {
    const leadTrigger = getWeeklyTrigger(item.day, item.startTime, leadMins);
    if (leadTrigger) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Upcoming routine: ${item.title}`,
          body,
          sound: 'default',
        },
        trigger: leadTrigger,
      });
      ids.push(id);
    }
  }

  const startTrigger = getWeeklyTrigger(item.day, item.startTime, 0);
  if (startTrigger) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Start now: ${item.title}`,
        body,
        sound: 'default',
      },
      trigger: startTrigger,
    });
    ids.push(id);
  }

  const endTrigger = getWeeklyTrigger(item.day, item.endTime, 0);
  if (endTrigger) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Ended: ${item.title}`,
        body,
        sound: 'default',
      },
      trigger: endTrigger,
    });
    ids.push(id);
  }

  return ids.length > 0 ? ids : null;
}

export default function RoutineScreen() {
  const insets = useSafeAreaInsets();
  const { reminderLeadTime } = useSchedule();

  const [items, setItems] = useState<RoutineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(getTodayShort());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [formDay, setFormDay] = useState(getTodayShort());
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [importOptionsModalOpen, setImportOptionsModalOpen] = useState(false);
  const [importExcelModalOpen, setImportExcelModalOpen] = useState(false);
  const [importJsonModalOpen, setImportJsonModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const documentPickingRef = useRef(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 + 34 : insets.bottom + 84;

  const persistRoutine = useCallback(async (next: RoutineItem[]) => {
    const sorted = sortRoutine(next);
    setItems(sorted);
    await AsyncStorage.setItem(ROUTINE_KEY, JSON.stringify(sorted));
  }, []);

  const loadRoutine = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(ROUTINE_KEY);
      const parsed: Array<Partial<RoutineItem> & { time?: string }> = raw ? JSON.parse(raw) : [];
      const normalized: RoutineItem[] = parsed.map((item, idx) => {
        const start = item.startTime ?? item.time ?? '08:00';
        const startH = parseInt(start.split(':')[0] ?? '8', 10);
        const startM = start.split(':')[1] ?? '00';
        const defaultEnd = `${String(Math.min(23, startH + 1)).padStart(2, '0')}:${startM}`;

        return {
          id: item.id ?? `legacy-${idx}-${Date.now()}`,
          title: item.title ?? 'Routine',
          day: item.day ?? 'Monday',
          startTime: start,
          endTime: item.endTime ?? defaultEnd,
          notes: item.notes ?? '',
          done: !!item.done,
          reminderEnabled: item.reminderEnabled ?? 0,
          reminderIds: Array.isArray(item.reminderIds) ? item.reminderIds : (item.reminderId ? [item.reminderId] : []),
          reminderId: item.reminderId ?? null,
        };
      });
      setItems(sortRoutine(normalized));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoutine();
  }, [loadRoutine]);

  useFocusEffect(
    useCallback(() => {
      void loadRoutine();
    }, [loadRoutine])
  );

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setFormDay(getTodayShort());
    setStartTime('08:00');
    setEndTime('09:00');
    setNotes('');
    setReminderEnabled(false);
  };

  const openAdd = () => {
    resetForm();
    setFormDay(selectedDay);
    setModalOpen(true);
  };

  const openEdit = (item: RoutineItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setFormDay(DAY_SHORT[item.day] ?? 'Mon');
    setStartTime(item.startTime);
    setEndTime(item.endTime);
    setNotes(item.notes);
    setReminderEnabled(!!item.reminderEnabled);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const importParsedItems = async (rows: ImportedRoutine[]) => {
    if (rows.length === 0) {
      Alert.alert('No items', 'No routine rows found to import.');
      return;
    }

    setImporting(true);
    try {
      const created: RoutineItem[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const item: RoutineItem = {
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          title: r.title,
          day: r.day,
          startTime: r.startTime,
          endTime: r.endTime,
          notes: r.notes,
          done: r.done,
          reminderEnabled: r.reminderEnabled,
          reminderIds: [],
          reminderId: null,
        };

        if (item.reminderEnabled) {
          const ids = await scheduleRoutineNotifications(item, reminderLeadTime);
          item.reminderIds = ids ?? [];
          item.reminderId = ids?.[0] ?? null;
          item.reminderEnabled = ids && ids.length > 0 ? 1 : 0;
        }

        created.push(item);
      }

      await persistRoutine([...items, ...created]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Imported', `${created.length} routine item${created.length !== 1 ? 's' : ''} imported.`);
    } finally {
      setImporting(false);
    }
  };

  const openImportOptions = () => {
    setImportOptionsModalOpen(true);
  };

  const importFromJson = async () => {
    try {
      const raw = JSON.parse(importJsonText.trim());
      if (!Array.isArray(raw)) throw new Error('JSON must be an array.');
      const rows = parseImportedRows(raw as Array<Record<string, unknown>>);
      await importParsedItems(rows);
      setImportJsonModalOpen(false);
      setImportJsonText('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON import.';
      Alert.alert('Import failed', msg);
    }
  };

  const importFromExcel = async () => {
    if (documentPickingRef.current) return;
    documentPickingRef.current = true;
    setImporting(true);
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const asset = pick.assets[0];
      if (!isExcelLikeFilename(asset.name ?? '')) {
        throw new Error('Please select an Excel/CSV file (.xlsx, .xls, .csv).');
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64 || base64.length < 16) throw new Error('Selected file could not be read.');
      if (!XLSX?.read || !XLSX?.utils?.sheet_to_json) throw new Error('Excel parser not available in this build.');
      const wb = XLSX.read(base64, { type: 'base64', raw: false, cellDates: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('Excel file has no sheet.');
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (!rows.length) throw new Error('No rows found in first sheet. Add header row and data rows.');
      const parsed = parseImportedRows(rows);
      await importParsedItems(parsed);
      setImportExcelModalOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not import Excel.';
      Alert.alert('Excel import failed', msg);
    } finally {
      setImporting(false);
      documentPickingRef.current = false;
    }
  };

  const saveItem = async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a routine title.');
      return;
    }
    if (!validTime(startTime.trim()) || !validTime(endTime.trim())) {
      Alert.alert('Invalid time', 'Use 24-hour format like 07:30 and 18:45.');
      return;
    }
    if (timeToMinutes(endTime.trim()) <= timeToMinutes(startTime.trim())) {
      Alert.alert('Invalid range', 'End time must be later than start time.');
      return;
    }

    const day = DAY_FULL[formDay] ?? 'Monday';

    if (editingId) {
      const prev = items.find(i => i.id === editingId);
      if (!prev) return;

      await cancelRoutineNotifications(prev);

      const nextBase: RoutineItem = {
        ...prev,
        title: title.trim(),
        day,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        notes: notes.trim(),
        reminderEnabled: reminderEnabled ? 1 : 0,
        reminderIds: [],
        reminderId: null,
      };

      if (reminderEnabled) {
        const scheduledIds = await scheduleRoutineNotifications(nextBase, reminderLeadTime);
        if (!scheduledIds) Alert.alert('Reminder disabled', 'Notification permission not granted.');
        nextBase.reminderIds = scheduledIds ?? [];
        nextBase.reminderId = scheduledIds?.[0] ?? null;
        nextBase.reminderEnabled = scheduledIds && scheduledIds.length > 0 ? 1 : 0;
      }

      await persistRoutine(items.map(i => (i.id === editingId ? nextBase : i)));
    } else {
      const id = String(Date.now());
      const nextItem: RoutineItem = {
        id,
        title: title.trim(),
        day,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        notes: notes.trim(),
        done: false,
        reminderEnabled: reminderEnabled ? 1 : 0,
        reminderIds: [],
        reminderId: null,
      };

      if (reminderEnabled) {
        const scheduledIds = await scheduleRoutineNotifications(nextItem, reminderLeadTime);
        if (!scheduledIds) Alert.alert('Reminder disabled', 'Notification permission not granted.');
        nextItem.reminderIds = scheduledIds ?? [];
        nextItem.reminderId = scheduledIds?.[0] ?? null;
        nextItem.reminderEnabled = scheduledIds && scheduledIds.length > 0 ? 1 : 0;
      }

      await persistRoutine([...items, nextItem]);
    }

    Haptics.selectionAsync();
    closeModal();
  };

  const toggleDone = async (id: string, value: boolean) => {
    Haptics.selectionAsync();
    await persistRoutine(items.map(i => (i.id === id ? { ...i, done: value } : i)));
  };

  const toggleReminder = async (item: RoutineItem, value: boolean) => {
    Haptics.selectionAsync();

    if (!value) {
      await cancelRoutineNotifications(item);
      await persistRoutine(items.map(i => (i.id === item.id ? { ...i, reminderEnabled: 0, reminderIds: [], reminderId: null } : i)));
      return;
    }

    const ids = await scheduleRoutineNotifications(item, reminderLeadTime);
    if (!ids) {
      Alert.alert('Reminder disabled', 'Notification permission not granted.');
      return;
    }

    await persistRoutine(items.map(i => (i.id === item.id ? { ...i, reminderEnabled: 1, reminderIds: ids, reminderId: ids[0] ?? null } : i)));
  };

  const deleteItem = (item: RoutineItem) => {
    Alert.alert('Delete routine', 'Remove this routine item?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await cancelRoutineNotifications(item);
          await persistRoutine(items.filter(i => i.id !== item.id));
        },
      },
    ]);
  };

  const filtered = useMemo(
    () => items.filter(i => DAY_SHORT[i.day] === selectedDay || i.day === DAY_FULL[selectedDay]),
    [items, selectedDay]
  );

  const emptyText = useMemo(
    () => (loading ? 'Loading...' : `No routine items for ${DAY_FULL[selectedDay]}. Tap + to add one.`),
    [loading, selectedDay]
  );

  const now = new Date(nowMs);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}> 
      <View style={styles.header}>
        <Text style={styles.title}>Daily Routine</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.importBtn} onPress={openImportOptions} disabled={importing}>
            {importing ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={22} color={Colors.bg} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayBar} contentContainerStyle={styles.dayBarContent}>
        {DAYS.map(d => {
          const isToday = d === getTodayShort();
          const isSelected = d === selectedDay;
          return (
            <TouchableOpacity
              key={d}
              style={[styles.dayPill, isSelected && styles.dayPillSelected]}
              onPress={() => setSelectedDay(d)}
              activeOpacity={0.8}
            >
              {isToday && <View style={styles.todayDot} />}
              <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPad, gap: 10 }}
        ListEmptyComponent={<Text style={styles.emptyText}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.itemCard, isCurrentRoutine(item, now) && styles.itemCardCurrent]}>
            <TouchableOpacity
              style={[styles.doneToggle, item.done && styles.doneToggleOn]}
              onPress={() => toggleDone(item.id, !item.done)}
              activeOpacity={0.8}
            >
              <Ionicons name={item.done ? 'checkmark' : 'ellipse-outline'} size={16} color={item.done ? Colors.bg : Colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.itemBody}>
              <View style={styles.itemTopRow}>
                <Text style={[styles.itemTitle, item.done && styles.itemDone]}>{item.title}</Text>
                {isCurrentRoutine(item, now) && (
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>{currentLeft(item, now)}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.itemMeta}>
                {formatTime(item.startTime)} - {formatTime(item.endTime)}{item.notes ? ` • ${item.notes}` : ''}
              </Text>

              <View style={styles.itemFooter}>
                <View style={styles.reminderRow}>
                  <Ionicons name="notifications-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.reminderLabel}>Reminder</Text>
                  <Switch
                    value={!!item.reminderEnabled}
                    onValueChange={v => toggleReminder(item, v)}
                    trackColor={{ false: Colors.surface3, true: Colors.primaryDim }}
                    thumbColor={item.reminderEnabled ? Colors.primary : Colors.textMuted}
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                </View>

                <View style={styles.actions}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(item)}>
                    <Ionicons name="pencil-outline" size={16} color={Colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => deleteItem(item)}>
                    <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}
      />

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId ? 'Edit Routine' : 'Add Routine'}</Text>
              <TouchableOpacity onPress={closeModal} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalDayRow}>
              {DAYS.map(d => (
                <TouchableOpacity
                  key={`form-${d}`}
                  style={[styles.modalDayPill, formDay === d && styles.modalDayPillSelected]}
                  onPress={() => setFormDay(d)}
                >
                  <Text style={[styles.modalDayText, formDay === d && styles.modalDayTextSelected]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Routine title"
              placeholderTextColor={Colors.textMuted}
            />

            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={startTime}
                onChangeText={v => setStartTime(normalizeTimeInput(v))}
                placeholder="Start HH:MM"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={5}
              />
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={endTime}
                onChangeText={v => setEndTime(normalizeTimeInput(v))}
                placeholder="End HH:MM"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={5}
              />
            </View>

            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (optional)"
              placeholderTextColor={Colors.textMuted}
              multiline
            />

            <View style={styles.formReminderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="notifications-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.reminderLabel}>Reminder</Text>
              </View>
              <Switch
                value={reminderEnabled}
                onValueChange={setReminderEnabled}
                trackColor={{ false: Colors.surface3, true: Colors.primaryDim }}
                thumbColor={reminderEnabled ? Colors.primary : Colors.textMuted}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveItem}>
                <Ionicons name={editingId ? 'checkmark' : 'add'} size={18} color={Colors.bg} />
                <Text style={styles.saveText}>{editingId ? 'Update' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={importOptionsModalOpen} animationType="fade" transparent onRequestClose={() => setImportOptionsModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import Routine</Text>
              <TouchableOpacity onPress={() => setImportOptionsModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.subtitleText}>Choose how you'd like to import your routine</Text>

            <TouchableOpacity
              style={styles.optionCard}
              onPress={() => {
                setImportOptionsModalOpen(false);
                setImportJsonModalOpen(true);
              }}
            >
              <View style={styles.optionIcon}>
                <Ionicons name="code-slash-outline" size={22} color={Colors.primary} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Paste JSON</Text>
                <Text style={styles.optionDesc}>Import from a JSON array of routine items</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.optionCard}
              onPress={() => {
                setImportOptionsModalOpen(false);
                setImportExcelModalOpen(true);
              }}
            >
              <View style={[styles.optionIcon, { backgroundColor: 'rgba(74,144,217,0.1)' }]}>
                <Ionicons name="document-text-outline" size={22} color={Colors.accent} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Upload Excel</Text>
                <Text style={styles.optionDesc}>Works when columns are: day, title, startTime, endTime, notes, reminderEnabled, done</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={importExcelModalOpen} animationType="fade" transparent onRequestClose={() => setImportExcelModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Excel</Text>
              <TouchableOpacity onPress={() => setImportExcelModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.importHelpText}>
              Select an Excel or CSV file. Required columns: day, title, startTime, endTime.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setImportExcelModalOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => { void importFromExcel(); }}
                disabled={importing}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={Colors.bg} />
                ) : (
                  <>
                    <Ionicons name="folder-open-outline" size={16} color={Colors.bg} />
                    <Text style={styles.saveText}>Choose File</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={importJsonModalOpen} animationType="fade" transparent onRequestClose={() => setImportJsonModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import JSON</Text>
              <TouchableOpacity onPress={() => setImportJsonModalOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.importHelpText}>
              Use an array of objects with fields: day, title, startTime, endTime, notes, reminderEnabled, done
            </Text>

            <TextInput
              style={[styles.input, styles.importJsonInput]}
              value={importJsonText}
              onChangeText={setImportJsonText}
              placeholder={`[\n  {\n    "day": "Monday",\n    "title": "Gym",\n    "startTime": "07:00",\n    "endTime": "08:00"\n  }\n]`}
              placeholderTextColor={Colors.textMuted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setImportJsonModalOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={() => { void importFromJson(); }} disabled={importing}>
                {importing ? (
                  <ActivityIndicator size="small" color={Colors.bg} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={16} color={Colors.bg} />
                    <Text style={styles.saveText}>Import</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayBar: {
    flexGrow: 0,
    marginBottom: 8,
    height: 40,
  },
  dayBarContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  dayPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayPillSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  todayDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.accent,
  },
  dayText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dayTextSelected: {
    color: Colors.bg,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 20,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  itemCardCurrent: {
    borderColor: Colors.primary,
    backgroundColor: '#131A0A',
  },
  doneToggle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface2,
    marginTop: 2,
  },
  doneToggleOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  itemBody: {
    flex: 1,
    gap: 6,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    flex: 1,
  },
  itemDone: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  itemMeta: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    marginTop: 2,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reminderLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212,175,55,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  liveText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: Colors.primary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 5,
    paddingBottom: 5,
  },
  modalTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  modalDayRow: {
    gap: 8,
  },
  modalDayPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalDayPillSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modalDayText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  modalDayTextSelected: {
    color: Colors.bg,
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
  timeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeInput: {
    flex: 1,
  },
  notesInput: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  formReminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subtitleText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  optionDesc: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  importHelpText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  importJsonInput: {
    minHeight: 170,
    maxHeight: 260,
    width: '100%',
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
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



