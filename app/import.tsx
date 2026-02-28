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
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useSchedule } from '@/context/ScheduleContext';
import { InsertLecture } from '@/lib/database';
import Colors from '@/constants/colors';

type ImportMode = 'choose' | 'json' | 'pdf-info' | 'processing';

function parseTimetablePdf(text: string, semester: string, section: string): InsertLecture[] {
  const lectures: InsertLecture[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const slotRegex = /S-\d+\s*\((\d+:\d+)\s*[-–]\s*(\d+:\d+)\)/gi;

  let currentDay = '';
  const slots: { start: string; end: string }[] = [];

  for (const line of lines) {
    const dayFound = days.find(d => line.includes(d));
    if (dayFound) {
      currentDay = dayFound;
      slots.length = 0;
    }

    let match: RegExpExecArray | null;
    slotRegex.lastIndex = 0;
    while ((match = slotRegex.exec(line)) !== null) {
      slots.push({ start: match[1], end: match[2] });
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
      const content = await FileSystem.readAsStringAsync(pdfUri, {
        encoding: FileSystem.EncodingType.UTF8,
      }).catch(() => null);

      if (!content || content.length < 50) {
        Alert.alert(
          'PDF Not Readable',
          'This PDF cannot be read as text. Please use JSON import instead.\n\nTip: Copy your timetable data into the JSON format and use the JSON import option.',
          [{ text: 'Use JSON Import', onPress: () => setMode('json') }, { text: 'Cancel', onPress: () => setMode('choose') }]
        );
        return;
      }

      const lectures = parseTimetablePdf(content, semester.trim(), section.trim());

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
