import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform, AppState, AppStateStatus } from 'react-native';
import {
  Lecture,
  InsertLecture,
  getAllLectures,
  insertLecture,
  updateLecture,
  deleteLecture,
  toggleReminder,
  getSetting,
  setSetting,
  insertLectures,
  deleteAllLectures,
} from '@/lib/database';

// Initialize notification channel for Android
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
  
  Notifications.setNotificationChannelAsync('lectures', {
    name: 'Lecture Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
  
  Notifications.setNotificationChannelAsync('routine', {
    name: 'Routine Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
}

const ALERT_MODES = ['none', 'start', 'end', 'both'] as const;
export type AlertMode = typeof ALERT_MODES[number];

function parseAlertMode(value: string | null): AlertMode {
  if (value && ALERT_MODES.includes(value as AlertMode)) return value as AlertMode;
  return 'both';
}

interface ScheduleContextValue {
  lectures: Lecture[];
  loading: boolean;
  reminderLeadTime: number;
  lectureAlertMode: AlertMode;
  routineAlertMode: AlertMode;
  setReminderLeadTime: (mins: number) => Promise<void>;
  setLectureAlertMode: (mode: AlertMode) => Promise<void>;
  setRoutineAlertMode: (mode: AlertMode) => Promise<void>;
  addLecture: (lecture: InsertLecture) => Promise<void>;
  editLecture: (lecture: Lecture) => Promise<void>;
  removeLecture: (id: number) => Promise<void>;
  toggleLectureReminder: (id: number, enabled: boolean) => Promise<void>;
  importLectures: (lectures: InsertLecture[]) => Promise<void>;
  clearAllLectures: () => Promise<void>;
  refresh: () => Promise<void>;
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getDayNumber(day: string): number {
  const days: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  return days[day] ?? -1;
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

  const weekday = triggerDay === 0 ? 1 : triggerDay + 1;
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  
  return {
    type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    weekday,
    hour,
    minute,
    repeats: true,
  };
}

async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  // For Android 13+, we need to request POST_NOTIFICATIONS permission
  if (Platform.OS === 'android') {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === 'granted') {
      return true;
    }
    
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  }
  
  // For iOS
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function scheduleLectureNotifications(lecture: Lecture, mode: AlertMode, leadTime: number): Promise<string[] | null> {
  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  await Notifications.cancelScheduledNotificationAsync(`lecture-${lecture.id}-remind`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lecture.id}-start`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lecture.id}-end`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lecture.id}`).catch(() => {});

  const ids: string[] = [];

  if (leadTime > 0) {
    const trigger = getWeeklyTrigger(lecture.day, lecture.startTime, leadTime);
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        identifier: `lecture-${lecture.id}-remind`,
        content: {
          title: `Upcoming: ${lecture.subject}`,
          body: `${lecture.room} · ${lecture.teacher} · Starts at ${lecture.startTime}`,
          sound: true,
        },
        trigger,
      });
      ids.push(id);
    }
  }

  if (mode === 'start' || mode === 'both') {
    const trigger = getWeeklyTrigger(lecture.day, lecture.startTime, 0);
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        identifier: `lecture-${lecture.id}-start`,
        content: {
          title: `Lecture Started: ${lecture.subject}`,
          body: `${lecture.room} · ${lecture.teacher}`,
          sound: true,
        },
        trigger,
      });
      ids.push(id);
    }
  }

  if (mode === 'end' || mode === 'both') {
    const trigger = getWeeklyTrigger(lecture.day, lecture.endTime, 0);
    if (trigger) {
      const id = await Notifications.scheduleNotificationAsync({
        identifier: `lecture-${lecture.id}-end`,
        content: {
          title: `Lecture Ended: ${lecture.subject}`,
          body: `${lecture.room} · ${lecture.teacher}`,
          sound: true,
        },
        trigger,
      });
      ids.push(id);
    }
  }

  return ids.length > 0 ? ids : null;
}

async function cancelLectureNotifications(lectureId: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lectureId}-remind`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lectureId}-start`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lectureId}-end`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lectureId}`).catch(() => {});
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderLeadTime, setReminderLeadTimeState] = useState(10);
  const [lectureAlertMode, setLectureAlertModeState] = useState<AlertMode>('both');
  const [routineAlertMode, setRoutineAlertModeState] = useState<AlertMode>('both');

  const refresh = useCallback(async () => {
    try {
      const all = await getAllLectures();
      setLectures(all);
    } catch (e) {
      console.error('Failed to load lectures:', e);
    }
  }, []);

  const resyncLectureNotifications = useCallback(async (
    allLectures: Lecture[],
    mode: AlertMode,
    leadTime: number
  ) => {
    for (const lecture of allLectures) {
      try {
        if (lecture.reminderEnabled) {
          await scheduleLectureNotifications(lecture, mode, leadTime);
        } else {
          await cancelLectureNotifications(lecture.id);
        }
      } catch (e) {
        console.error(`Failed to sync notifications for lecture ${lecture.id}:`, e);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [all, leadStr, lectureModeStr, routineModeStr] = await Promise.all([
          getAllLectures(),
          getSetting('reminderLeadTime'),
          getSetting('lectureAlertMode'),
          getSetting('routineAlertMode'),
        ]);
        setLectures(all);
        if (leadStr) setReminderLeadTimeState(parseInt(leadStr, 10));
        setLectureAlertModeState(parseAlertMode(lectureModeStr));
        setRoutineAlertModeState(parseAlertMode(routineModeStr));
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setReminderLeadTime = useCallback(async (mins: number) => {
    setReminderLeadTimeState(mins);
    await setSetting('reminderLeadTime', String(mins));
    const all = await getAllLectures();
    await resyncLectureNotifications(all, lectureAlertMode, mins);
  }, [lectureAlertMode, resyncLectureNotifications]);

  const setLectureAlertMode = useCallback(async (mode: AlertMode) => {
    setLectureAlertModeState(mode);
    await setSetting('lectureAlertMode', mode);
    const all = await getAllLectures();
    await resyncLectureNotifications(all, mode, reminderLeadTime);
  }, [reminderLeadTime, resyncLectureNotifications]);

  const setRoutineAlertMode = useCallback(async (mode: AlertMode) => {
    setRoutineAlertModeState(mode);
    await setSetting('routineAlertMode', mode);
  }, []);

  const addLecture = useCallback(async (lecture: InsertLecture) => {
    const id = await insertLecture(lecture);
    await refresh();
    if (lecture.reminderEnabled) {
      const newLecture: Lecture = { ...lecture, id, reminderEnabled: 1 };
      try {
        await scheduleLectureNotifications(newLecture, lectureAlertMode, reminderLeadTime);
      } catch (e) {
        console.error(`Failed to schedule notifications for lecture ${id}:`, e);
      }
    }
  }, [refresh, lectureAlertMode, reminderLeadTime]);

  const editLecture = useCallback(async (lecture: Lecture) => {
    await updateLecture(lecture);
    await refresh();
    try {
      if (lecture.reminderEnabled) {
        await scheduleLectureNotifications(lecture, lectureAlertMode, reminderLeadTime);
      } else {
        await cancelLectureNotifications(lecture.id);
      }
    } catch (e) {
      console.error(`Failed to update notifications for lecture ${lecture.id}:`, e);
    }
  }, [refresh, lectureAlertMode, reminderLeadTime]);

  const removeLecture = useCallback(async (id: number) => {
    await cancelLectureNotifications(id);
    await deleteLecture(id);
    setLectures(prev => prev.filter(l => l.id !== id));
  }, []);

  const toggleLectureReminder = useCallback(async (id: number, enabled: boolean) => {
    await toggleReminder(id, enabled);
    setLectures(prev => prev.map(l => l.id === id ? { ...l, reminderEnabled: enabled ? 1 : 0 } : l));
    const all = await getAllLectures();
    const lecture = all.find(l => l.id === id);
    if (!lecture) return;
    try {
      if (enabled) {
        await scheduleLectureNotifications(lecture, lectureAlertMode, reminderLeadTime);
      } else {
        await cancelLectureNotifications(id);
      }
    } catch (e) {
      console.error(`Failed to toggle notifications for lecture ${id}:`, e);
    }
  }, [lectureAlertMode, reminderLeadTime]);

  const importLectures = useCallback(async (newLectures: InsertLecture[]) => {
    await insertLectures(newLectures);
    const all = await getAllLectures();
    setLectures(all);
    await resyncLectureNotifications(all, lectureAlertMode, reminderLeadTime);
  }, [lectureAlertMode, reminderLeadTime, resyncLectureNotifications]);

  const clearAllLectures = useCallback(async () => {
    for (const lecture of lectures) {
      await cancelLectureNotifications(lecture.id);
    }
    await deleteAllLectures();
    setLectures([]);
  }, [lectures]);

  const value = useMemo(() => ({
    lectures,
    loading,
    reminderLeadTime,
    lectureAlertMode,
    routineAlertMode,
    setReminderLeadTime,
    setLectureAlertMode,
    setRoutineAlertMode,
    addLecture,
    editLecture,
    removeLecture,
    toggleLectureReminder,
    importLectures,
    clearAllLectures,
    refresh,
  }), [lectures, loading, reminderLeadTime, lectureAlertMode, routineAlertMode, setReminderLeadTime, setLectureAlertMode, setRoutineAlertMode, addLecture, editLecture, removeLecture, toggleLectureReminder, importLectures, clearAllLectures, refresh]);

  return (
    <ScheduleContext.Provider value={value}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useSchedule must be used within ScheduleProvider');
  return ctx;
}

export { timeToMinutes };
