import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
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
  }, []);

  const addLecture = useCallback(async (lecture: InsertLecture) => {
    await insertLecture(lecture);
    await refresh();
  }, [refresh]);

  const editLecture = useCallback(async (lecture: Lecture) => {
    await updateLecture(lecture);
    await refresh();
  }, [refresh]);

  const removeLecture = useCallback(async (id: number) => {
    await deleteLecture(id);
    setLectures(prev => prev.filter(l => l.id !== id));
  }, []);

  const toggleLectureReminder = useCallback(async (id: number, enabled: boolean) => {
    await toggleReminder(id, enabled);
    setLectures(prev => prev.map(l => l.id === id ? { ...l, reminderEnabled: enabled ? 1 : 0 } : l));
  }, []);

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

export { };
