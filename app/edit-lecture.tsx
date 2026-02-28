import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSchedule } from '@/context/ScheduleContext';
import Colors from '@/constants/colors';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function Field({ label, value, onChange, placeholder, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
      />
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export default function EditLectureScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode: string; id?: string; day?: string }>();
  const { lectures, addLecture, editLecture } = useSchedule();

  const isEdit = params.mode === 'edit';
  const existing = isEdit ? lectures.find(l => String(l.id) === params.id) : null;

  const [day, setDay] = useState(existing?.day ?? params.day ?? 'Monday');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [room, setRoom] = useState(existing?.room ?? '');
  const [teacher, setTeacher] = useState(existing?.teacher ?? '');
  const [startTime, setStartTime] = useState(existing?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '10:20');
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const validate = () => {
    if (!subject.trim()) { Alert.alert('Missing field', 'Please enter a subject.'); return false; }
    if (!room.trim()) { Alert.alert('Missing field', 'Please enter a room.'); return false; }
    if (!teacher.trim()) { Alert.alert('Missing field', 'Please enter a teacher name.'); return false; }
    const timeRe = /^\d{1,2}:\d{2}$/;
    if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
      Alert.alert('Invalid time', 'Use HH:MM format (e.g. 09:00).');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    try {
      if (isEdit && existing) {
        await editLecture({ ...existing, day, subject, room, teacher, startTime, endTime });
      } else {
        await addLecture({ day, subject, room, teacher, startTime, endTime, reminderEnabled: 0 });
      }
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to save lecture.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{isEdit ? 'Edit Lecture' : 'Add Lecture'}</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: botPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Day</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayRow}
          >
            {DAYS.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dayChip, day === d && styles.dayChipSelected]}
                onPress={() => { Haptics.selectionAsync(); setDay(d); }}
              >
                <Text style={[styles.dayChipText, day === d && styles.dayChipTextSelected]}>
                  {d.slice(0, 3)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <Field label="Subject" value={subject} onChange={setSubject} placeholder="e.g. Theory of Automata" />
        <Field label="Room" value={room} onChange={setRoom} placeholder="e.g. CR-35 - Third Floor" />
        <Field label="Teacher" value={teacher} onChange={setTeacher} placeholder="e.g. Ms. Hira Arshad" />

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.label}>Start Time</Text>
            <TextInput
              style={styles.input}
              value={startTime}
              onChangeText={setStartTime}
              placeholder="HH:MM"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <Ionicons name="arrow-forward" size={16} color={Colors.textMuted} style={{ marginTop: 32 }} />
          <View style={styles.timeField}>
            <Text style={styles.label}>End Time</Text>
            <TextInput
              style={styles.input}
              value={endTime}
              onChangeText={setEndTime}
              placeholder="HH:MM"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <Text style={styles.timeHint}>Use 24-hour format (e.g. 14:00 for 2:00 PM)</Text>
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
  saveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: Colors.bg,
  },
  scrollContent: {
    padding: 20,
    gap: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  dayRow: {
    gap: 8,
  },
  dayChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dayChipTextSelected: {
    color: Colors.bg,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
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
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 5,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 4,
  },
  timeField: {
    flex: 1,
  },
  timeHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
