import * as SQLite from 'expo-sqlite';

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

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('unischedule.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS lectures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      subject TEXT NOT NULL,
      room TEXT NOT NULL,
      teacher TEXT NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      reminderEnabled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES ('reminderLeadTime', '10');
  `);
  return db;
}

export async function getAllLectures(): Promise<Lecture[]> {
  const database = await getDb();
  return database.getAllAsync<Lecture>(
    'SELECT * FROM lectures ORDER BY CASE day WHEN "Monday" THEN 1 WHEN "Tuesday" THEN 2 WHEN "Wednesday" THEN 3 WHEN "Thursday" THEN 4 WHEN "Friday" THEN 5 WHEN "Saturday" THEN 6 WHEN "Sunday" THEN 7 ELSE 8 END, startTime ASC'
  );
}

export async function insertLecture(lecture: InsertLecture): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO lectures (day, subject, room, teacher, startTime, endTime, reminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
    lecture.day,
    lecture.subject,
    lecture.room,
    lecture.teacher,
    lecture.startTime,
    lecture.endTime,
    lecture.reminderEnabled ?? 0
  );
  return result.lastInsertRowId;
}

export async function updateLecture(lecture: Lecture): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE lectures SET day=?, subject=?, room=?, teacher=?, startTime=?, endTime=?, reminderEnabled=? WHERE id=?',
    lecture.day,
    lecture.subject,
    lecture.room,
    lecture.teacher,
    lecture.startTime,
    lecture.endTime,
    lecture.reminderEnabled,
    lecture.id
  );
}

export async function deleteLecture(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM lectures WHERE id=?', id);
}

export async function toggleReminder(id: number, enabled: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE lectures SET reminderEnabled=? WHERE id=?', enabled ? 1 : 0, id);
}

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export async function insertLectures(lectures: InsertLecture[]): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    for (const l of lectures) {
      await database.runAsync(
        'INSERT INTO lectures (day, subject, room, teacher, startTime, endTime, reminderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
        l.day, l.subject, l.room, l.teacher, l.startTime, l.endTime, l.reminderEnabled ?? 0
      );
    }
  });
}
