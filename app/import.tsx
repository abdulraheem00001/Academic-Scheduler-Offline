import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { unzlibSync } from 'fflate';
import { useSchedule } from '@/context/ScheduleContext';
import { InsertLecture } from '@/lib/database';
import Colors from '@/constants/colors';

type ImportMode = 'choose' | 'json' | 'pdf-info' | 'processing';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SECTION_ORDER = [
  { semester: 1, section: 'M1' },
  { semester: 1, section: 'M2' },
  { semester: 2, section: 'M1' },
  { semester: 2, section: 'M2' },
  { semester: 3, section: 'M1' },
  { semester: 3, section: 'M2' },
  { semester: 4, section: 'A' },
  { semester: 4, section: 'B' },
  { semester: 5, section: 'A' },
  { semester: 5, section: 'B' },
];
function parseSemesterNumber(value: string): number | null {
  const match = value.match(/([1-8])/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= 1 && n <= 8 ? n : null;
}
function normalizeTextToken(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeTime(value: string, fallbackMeridiem: 'AM' | 'PM' = 'AM'): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!m) return value.trim();
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const mer = (m[3]?.toUpperCase() as 'AM' | 'PM' | undefined) ?? fallbackMeridiem;
  if (mer === 'AM') {
    if (h === 12) h = 0;
  } else if (h < 12) {
    h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function parseSlotRange(token: string): { start: string; end: string } | null {
  const slotMatch = token.match(/S-\d+\s*\(([^)]+)\)/i);
  if (!slotMatch) return null;
  const raw = slotMatch[1].replace(/\s+/g, '');
  const rangeMatch = raw.match(/(\d{1,2}:\d{2}(?:[AP]M)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:[AP]M)?)/i);
  if (!rangeMatch) return null;
  const startRaw = rangeMatch[1];
  const endRaw = rangeMatch[2];
  const endMeridiem = /PM$/i.test(endRaw) ? 'PM' : /AM$/i.test(endRaw) ? 'AM' : undefined;
  const fallbackMeridiem: 'AM' | 'PM' = endMeridiem ?? (parseInt(startRaw.split(':')[0], 10) >= 8 ? 'AM' : 'PM');
  return {
    start: normalizeTime(startRaw, fallbackMeridiem),
    end: normalizeTime(endRaw, fallbackMeridiem),
  };
}
function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (!next) break;
    if (/[0-7]/.test(next)) {
      let oct = next;
      if (/[0-7]/.test(raw[i + 2] ?? '')) oct += raw[i + 2];
      if (/[0-7]/.test(raw[i + 3] ?? '')) oct += raw[i + 3];
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length;
      continue;
    }
    const escapes: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      '\\': '\\',
      '(': '(',
      ')': ')',
    };
    out += escapes[next] ?? next;
    i += 1;
  }
  return out;
}
function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length < 2) return '';
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    bytes[i / 2] = parseInt(padded.slice(i, i + 2), 16);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  return String.fromCharCode(...bytes);
}
function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}
function binaryToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}
function base64ToBytes(base64: string): Uint8Array {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not available on this device.');
  }
  return binaryToBytes(globalThis.atob(base64));
}
function extractPdfTokens(pdfBytes: Uint8Array): string[] {
  const binary = bytesToBinary(pdfBytes);
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const tokens: string[] = [];
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamRegex.exec(binary)) !== null) {
    const streamBytes = binaryToBytes(streamMatch[1]);
    const objectHeader = binary.slice(Math.max(0, streamMatch.index - 500), streamMatch.index);
    let decodedBytes = streamBytes;
    if (/\/FlateDecode/.test(objectHeader)) {
      try {
        decodedBytes = unzlibSync(streamBytes);
      } catch {
        continue;
      }
    }
    const decoded = bytesToBinary(decodedBytes);
    const textBlocks = decoded.match(/BT[\s\S]*?ET/g) ?? [];
    for (const block of textBlocks) {
      for (const arrayMatch of block.matchAll(/\[(.*?)\]\s*TJ/gs)) {
        const parts: string[] = [];
        for (const literalMatch of arrayMatch[1].matchAll(/\((?:\\.|[^\\()])*\)/g)) {
          parts.push(decodePdfLiteralString(literalMatch[0].slice(1, -1)));
        }
        for (const hexMatch of arrayMatch[1].matchAll(/<([0-9a-fA-F\s]+)>/g)) {
          parts.push(decodePdfHexString(hexMatch[1]));
        }
        const normalized = normalizeTextToken(parts.join(''));
        if (normalized) tokens.push(normalized);
      }
      for (const literalTj of block.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)) {
        const value = decodePdfLiteralString(literalTj[0].replace(/\)\s*Tj$/, '').slice(1));
        const normalized = normalizeTextToken(value);
        if (normalized) tokens.push(normalized);
      }
    }
  }
  return tokens;
}
function parseTimetablePdf(pdfBytes: Uint8Array, semesterInput: string, sectionInput: string): InsertLecture[] {
  const targetSemester = parseSemesterNumber(semesterInput);
  if (!targetSemester) throw new Error('Invalid semester. Use 1 to 8 (example: 5th).');
  const targetSection = sectionInput.trim().toUpperCase();
  const tokens = extractPdfTokens(pdfBytes);
  if (tokens.length === 0) return [];
  const slots = tokens
    .map(parseSlotRange)
    .filter((x): x is { start: string; end: string } => Boolean(x))
    .slice(0, 6);
  const defaultSlots = [
    { start: '08:00', end: '09:20' },
    { start: '09:30', end: '10:50' },
    { start: '11:00', end: '12:20' },
    { start: '12:30', end: '13:50' },
    { start: '14:00', end: '15:20' },
    { start: '15:30', end: '16:50' },
  ];
  const slotTimes = slots.length >= 6 ? slots : defaultSlots;
  const controlTokens = new Set([
    'Section',
    'Slots',
    'Semester',
    'Time Table - Spring 2026 - BS Computer Science (Morning)',
    ...DAYS,
    ...SECTION_ORDER.map(s => s.section),
    '1st Semester',
    '2nd Semester',
    '3rd Semester',
    '4th Semester',
    '5th Semester',
    '6th Semester',
    '7th Semester',
    '8th Semester',
  ]);
  const lectures: InsertLecture[] = [];
  const seen = new Set<string>();
  const daySegments: Array<{ day: string; tokens: string[] }> = [];
  let pending: string[] = [];

  for (const token of tokens) {
    if (DAYS.includes(token)) {
      daySegments.push({ day: token, tokens: pending });
      pending = [];
      continue;
    }
    pending.push(token);
  }

  for (const segment of daySegments) {
    let currentSemester = 0;
    let currentSection = '';
    let sectionOrderIndex = 0;
    let slotIndex = 0;

    for (let i = 0; i < segment.tokens.length; i += 1) {
      const token = segment.tokens[i];
      const semesterNum = parseSemesterNumber(token);

      if (semesterNum && /Semester$/i.test(token)) {
        currentSemester = semesterNum;
        currentSection = '';
        slotIndex = 0;
        continue;
      }

      if (token === 'M1' || token === 'M2' || token === 'A' || token === 'B') {
        let resolvedIndex = sectionOrderIndex;
        if (SECTION_ORDER[resolvedIndex]?.section !== token) {
          const found = SECTION_ORDER.findIndex((entry, idx) => idx >= sectionOrderIndex && entry.section === token);
          if (found !== -1) resolvedIndex = found;
        }
        const resolved = SECTION_ORDER[resolvedIndex];
        currentSemester = resolved?.semester ?? currentSemester;
        currentSection = token;
        slotIndex = 0;
        sectionOrderIndex = Math.min(resolvedIndex + 1, SECTION_ORDER.length);
        continue;
      }

      const room = segment.tokens[i + 1] ?? '';
      if (!room || slotIndex >= slotTimes.length) continue;
      if (controlTokens.has(token) || controlTokens.has(room)) continue;
      if (!/(CR-|CS Lab|DLD Lab|Lab|Room|Floor)/i.test(room)) continue;

      const teacherCandidate = segment.tokens[i + 2] ?? '';
      const hasTeacher = /^(Mr\.|Ms\.|Dr\.)/i.test(teacherCandidate);
      const teacher = hasTeacher ? teacherCandidate : 'TBA';

      if (targetSemester === currentSemester && (!targetSection || targetSection === currentSection)) {
        const slot = slotTimes[slotIndex];
        const lecture: InsertLecture = {
          day: segment.day,
          subject: token,
          room,
          teacher,
          startTime: slot.start,
          endTime: slot.end,
          reminderEnabled: 0,
        };
        const key = `${lecture.day}|${lecture.startTime}|${lecture.endTime}|${lecture.subject}|${lecture.room}|${lecture.teacher}`;
        if (!seen.has(key)) {
          seen.add(key);
          lectures.push(lecture);
        }
      }

      slotIndex += 1;
      i += hasTeacher ? 2 : 1;
    }
  }

  return lectures;
}

function parseJsonLectures(text: string): InsertLecture[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('JSON must be an array of lectures.');
  return raw.map((item: Record<string, string>, i: number) => {
    if (!item.day || !item.subject || !item.room || !item.teacher || !item.startTime || !item.endTime) {
      throw new Error(`Item ${i + 1} is missing required fields.`);
    }
    if (!days.includes(item.day)) throw new Error(`Invalid day "${item.day}" in item ${i + 1}.`);
    return {
      day: item.day,
      subject: item.subject,
      room: item.room,
      teacher: item.teacher,
      startTime: item.startTime,
      endTime: item.endTime,
      reminderEnabled: 0,
    };
  });
}

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const { importLectures } = useSchedule();
  const [mode, setMode] = useState<ImportMode>('choose');
  const [jsonText, setJsonText] = useState('');
  const [semester, setSemester] = useState('');
  const [section, setSection] = useState('');
  const [pdfUri, setPdfUri] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [importing, setImporting] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handlePickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setPdfUri(asset.uri);
      setPdfName(asset.name);
      setMode('pdf-info');
    } catch {
      Alert.alert('Error', 'Could not open file picker.');
    }
  };

  const handleImportJson = async () => {
    if (!jsonText.trim()) {
      Alert.alert('Empty', 'Please paste your JSON data.');
      return;
    }
    setImporting(true);
    try {
      const lectures = parseJsonLectures(jsonText.trim());
      await importLectures(lectures);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Imported',
        `${lectures.length} lecture${lectures.length !== 1 ? 's' : ''} added to your schedule.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON format.';
      Alert.alert('Import Failed', msg);
    } finally {
      setImporting(false);
    }
  };

  const handleImportPdf = async () => {
    if (!semester.trim()) {
      Alert.alert('Missing', 'Please enter the semester (e.g. 5th).');
      return;
    }
    if (!pdfUri) {
      Alert.alert('No File', 'Please select a PDF file first.');
      return;
    }
    setImporting(true);
    setMode('processing');
    try {
      const pdfBase64 = await FileSystem.readAsStringAsync(pdfUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const pdfBytes = base64ToBytes(pdfBase64);
      const lectures = parseTimetablePdf(pdfBytes, semester.trim(), section.trim());

      if (lectures.length === 0) {
        Alert.alert(
          'No Lectures Found',
          `Could not automatically extract lectures from this PDF for semester "${semester}" section "${section || 'N/A'}".\n\nThis timetable format may not be supported. Please use JSON import instead.`,
          [{ text: 'Use JSON Import', onPress: () => setMode('json') }, { text: 'Cancel', onPress: () => setMode('choose') }]
        );
        return;
      }

      await importLectures(lectures);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Imported',
        `${lectures.length} lecture${lectures.length !== 1 ? 's' : ''} imported successfully.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch {
      Alert.alert('Error', 'Failed to process PDF. Please try JSON import instead.');
      setMode('pdf-info');
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (mode === 'choose') router.back();
          else setMode('choose');
        }} hitSlop={8}>
          <Ionicons name={mode === 'choose' ? 'close' : 'arrow-back'} size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Import Schedule</Text>
        <View style={{ width: 24 }} />
      </View>

      {mode === 'choose' && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: botPad + 24 }]}>
          <Text style={styles.subtitle}>Choose how you'd like to import your timetable</Text>

          <TouchableOpacity style={styles.optionCard} onPress={() => setMode('json')}>
            <View style={styles.optionIcon}>
              <MaterialCommunityIcons name="code-json" size={28} color={Colors.primary} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Paste JSON</Text>
              <Text style={styles.optionDesc}>Import from a JSON array with day, subject, room, teacher, startTime, endTime fields</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.optionCard} onPress={handlePickPdf}>
            <View style={[styles.optionIcon, { backgroundColor: 'rgba(74,144,217,0.1)' }]}>
              <Ionicons name="document-text-outline" size={28} color={Colors.accent} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Upload PDF</Text>
              <Text style={styles.optionDesc}>Import from a timetable PDF — you'll specify semester and section</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.jsonSampleCard}>
            <Text style={styles.jsonSampleTitle}>JSON Format</Text>
            <Text style={styles.jsonSample}>{`[
  {
    "day": "Monday",
    "subject": "Theory of Automata",
    "room": "CR-35 - Third Floor",
    "teacher": "Ms. Hira Arshad",
    "startTime": "11:00",
    "endTime": "12:20"
  }
]`}</Text>
          </View>
        </ScrollView>
      )}

      {mode === 'json' && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: botPad + 24 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Paste your JSON schedule below</Text>
          <TextInput
            style={styles.jsonInput}
            value={jsonText}
            onChangeText={setJsonText}
            multiline
            placeholder={`[\n  {\n    "day": "Monday",\n    "subject": "...",\n    ...\n  }\n]`}
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.importBtn, importing && { opacity: 0.6 }]}
            onPress={handleImportJson}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color={Colors.bg} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color={Colors.bg} />
                <Text style={styles.importBtnText}>Import Lectures</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {mode === 'pdf-info' && (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: botPad + 24 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.pdfFileCard}>
            <Ionicons name="document-text" size={22} color={Colors.accent} />
            <Text style={styles.pdfFileName} numberOfLines={1}>{pdfName}</Text>
          </View>

          <Text style={styles.subtitle}>Enter your details to filter the timetable</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Semester *</Text>
            <TextInput
              style={styles.input}
              value={semester}
              onChangeText={setSemester}
              placeholder="e.g. 5th or 5"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Section (optional)</Text>
            <TextInput
              style={styles.input}
              value={section}
              onChangeText={setSection}
              placeholder="e.g. A or B (leave blank if none)"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.pdfNote}>
            <Ionicons name="information-circle-outline" size={15} color={Colors.textMuted} />
            <Text style={styles.pdfNoteText}>
              PDF text extraction works best with text-based PDFs. If it fails, use JSON import instead.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.importBtn, importing && { opacity: 0.6 }]}
            onPress={handleImportPdf}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color={Colors.bg} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color={Colors.bg} />
                <Text style={styles.importBtnText}>Import from PDF</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {mode === 'processing' && (
        <View style={styles.processingState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.processingText}>Processing PDF...</Text>
          <Text style={styles.processingSubText}>This may take a moment</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: Colors.text,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(212,175,55,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
    gap: 3,
  },
  optionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: Colors.text,
  },
  optionDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  jsonSampleCard: {
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  jsonSampleTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  jsonSample: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  jsonInput: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: Colors.text,
    minHeight: 200,
    textAlignVertical: 'top',
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  importBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: Colors.bg,
  },
  pdfFileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(74,144,217,0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(74,144,217,0.2)',
  },
  pdfFileName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.accent,
    flex: 1,
  },
  field: {
    gap: 8,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: Colors.text,
  },
  pdfNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: -4,
  },
  pdfNoteText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },
  processingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  processingText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: Colors.text,
  },
  processingSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
  },
});

