import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Lecture {
  id: number;
  day: string;
  subject: string;
  room: string;
  teacher: string;
  startTime: string;
  endTime: string;
  reminderEnabled: number;
}

export interface InsertLecture {
  day: string;
  subject: string;
  room: string;
  teacher: string;
  startTime: string;
  endTime: string;
  reminderEnabled?: number;
}

const LECTURES_KEY = 'unischedule_lectures';
const SETTINGS_KEY = 'unischedule_settings';
const COUNTER_KEY = 'unischedule_counter';

async function getNextId(): Promise<number> {
  const val = await AsyncStorage.getItem(COUNTER_KEY);
  const next = (parseInt(val ?? '0', 10)) + 1;
  await AsyncStorage.setItem(COUNTER_KEY, String(next));
  return next;
}

async function loadLectures(): Promise<Lecture[]> {
  const val = await AsyncStorage.getItem(LECTURES_KEY);
  if (!val) return [];
  return JSON.parse(val);
}

async function saveLectures(lectures: Lecture[]): Promise<void> {
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(lectures));
}

export async function getDb(): Promise<unknown> { return null; }

export async function getAllLectures(): Promise<Lecture[]> {
  const all = await loadLectures();
  const dayOrder: Record<string, number> = {
    Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
  };
  return all.sort((a, b) => {
    const d = (dayOrder[a.day] ?? 8) - (dayOrder[b.day] ?? 8);
    if (d !== 0) return d;
    return a.startTime.localeCompare(b.startTime);
  });
}

export async function insertLecture(lecture: InsertLecture): Promise<number> {
  const all = await loadLectures();
  const id = await getNextId();
  all.push({ ...lecture, id, reminderEnabled: lecture.reminderEnabled ?? 0 });
  await saveLectures(all);
  return id;
}

export async function updateLecture(lecture: Lecture): Promise<void> {
  const all = await loadLectures();
  const idx = all.findIndex(l => l.id === lecture.id);
  if (idx >= 0) all[idx] = lecture;
  await saveLectures(all);
}

export async function deleteLecture(id: number): Promise<void> {
  const all = await loadLectures();
  await saveLectures(all.filter(l => l.id !== id));
}

export async function toggleReminder(id: number, enabled: boolean): Promise<void> {
  const all = await loadLectures();
  const idx = all.findIndex(l => l.id === id);
  if (idx >= 0) all[idx].reminderEnabled = enabled ? 1 : 0;
  await saveLectures(all);
}

export async function deleteAllLectures(): Promise<void> {
  await saveLectures([]);
}

export async function getSetting(key: string): Promise<string | null> {
  const val = await AsyncStorage.getItem(`${SETTINGS_KEY}_${key}`);
  return val ?? (key === 'reminderLeadTime' ? '10' : null);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(`${SETTINGS_KEY}_${key}`, value);
}

export async function insertLectures(lectures: InsertLecture[]): Promise<void> {
  const all = await loadLectures();
  for (const l of lectures) {
    const id = await getNextId();
    all.push({ ...l, id, reminderEnabled: l.reminderEnabled ?? 0 });
  }
  await saveLectures(all);
}
