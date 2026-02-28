import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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
} from '@/lib/database';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowList: true,
  }),
});

interface ScheduleContextValue {
  lectures: Lecture[];
  loading: boolean;
  reminderLeadTime: number;
  setReminderLeadTime: (mins: number) => Promise<void>;
  addLecture: (lecture: InsertLecture) => Promise<void>;
  editLecture: (lecture: Lecture) => Promise<void>;
  removeLecture: (id: number) => Promise<void>;
  toggleLectureReminder: (id: number, enabled: boolean) => Promise<void>;
  importLectures: (lectures: InsertLecture[]) => Promise<void>;
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

async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function scheduleNotification(lecture: Lecture, leadTime: number): Promise<string | null> {
  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  const dayNum = getDayNumber(lecture.day);
  if (dayNum < 0) return null;

  const startMins = timeToMinutes(lecture.startTime);
  const notifyMins = startMins - leadTime;
  const notifyHour = Math.floor(notifyMins / 60);
  const notifyMinute = notifyMins % 60;

  if (notifyHour < 0 || notifyMinute < 0) return null;

  await Notifications.cancelScheduledNotificationAsync(`lecture-${lecture.id}`).catch(() => {});

  const id = await Notifications.scheduleNotificationAsync({
    identifier: `lecture-${lecture.id}`,
    content: {
      title: `Upcoming: ${lecture.subject}`,
      body: `${lecture.room} · ${lecture.teacher} · Starts at ${lecture.startTime}`,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: dayNum === 0 ? 1 : dayNum + 1,
      hour: notifyHour,
      minute: notifyMinute,
    },
  });
  return id;
}

async function cancelNotification(lectureId: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`lecture-${lectureId}`).catch(() => {});
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderLeadTime, setReminderLeadTimeState] = useState(10);

  const refresh = useCallback(async () => {
    try {
      const all = await getAllLectures();
      setLectures(all);
    } catch (e) {
      console.error('Failed to load lectures:', e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [all, leadStr] = await Promise.all([getAllLectures(), getSetting('reminderLeadTime')]);
        setLectures(all);
        if (leadStr) setReminderLeadTimeState(parseInt(leadStr, 10));
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
    for (const l of all) {
      if (l.reminderEnabled) {
        await scheduleNotification(l, mins);
      }
    }
  }, []);

  const addLecture = useCallback(async (lecture: InsertLecture) => {
    const id = await insertLecture(lecture);
    await refresh();
    if (lecture.reminderEnabled) {
      const newLecture: Lecture = { ...lecture, id, reminderEnabled: 1 };
      await scheduleNotification(newLecture, reminderLeadTime);
    }
  }, [refresh, reminderLeadTime]);

  const editLecture = useCallback(async (lecture: Lecture) => {
    await updateLecture(lecture);
    await refresh();
    if (lecture.reminderEnabled) {
      await scheduleNotification(lecture, reminderLeadTime);
    } else {
      await cancelNotification(lecture.id);
    }
  }, [refresh, reminderLeadTime]);

  const removeLecture = useCallback(async (id: number) => {
    await cancelNotification(id);
    await deleteLecture(id);
    setLectures(prev => prev.filter(l => l.id !== id));
  }, []);

  const toggleLectureReminder = useCallback(async (id: number, enabled: boolean) => {
    await toggleReminder(id, enabled);
    setLectures(prev => prev.map(l => l.id === id ? { ...l, reminderEnabled: enabled ? 1 : 0 } : l));
    const all = await getAllLectures();
    const lecture = all.find(l => l.id === id);
    if (!lecture) return;
    if (enabled) {
      await scheduleNotification(lecture, reminderLeadTime);
    } else {
      await cancelNotification(id);
    }
  }, [reminderLeadTime]);

  const importLectures = useCallback(async (newLectures: InsertLecture[]) => {
    await insertLectures(newLectures);
    await refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    lectures,
    loading,
    reminderLeadTime,
    setReminderLeadTime,
    addLecture,
    editLecture,
    removeLecture,
    toggleLectureReminder,
    importLectures,
    refresh,
  }), [lectures, loading, reminderLeadTime, setReminderLeadTime, addLecture, editLecture, removeLecture, toggleLectureReminder, importLectures, refresh]);

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
