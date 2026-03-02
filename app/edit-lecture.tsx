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
type Meridiem = 'AM' | 'PM';

function normalizeDialerInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `0${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function toMeridiem(hhmm: string): Meridiem {
  const hh = parseInt((hhmm.split(':')[0] ?? '0'), 10);
  return hh >= 12 ? 'PM' : 'AM';
}

function parseTimeFromMode(value: string, is24Hour: boolean, meridiem: Meridiem): string {
  const raw = value.trim();
  if (!raw) return '';

  let hh = 0;
  let mm = 0;
  if (raw.includes(':')) {
    const m = raw.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return '';
    hh = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
  } else if (/^\d{3,4}$/.test(raw)) {
    if (raw.length === 3) {
      hh = parseInt(raw[0], 10);
      mm = parseInt(raw.slice(1), 10);
    } else {
      hh = parseInt(raw.slice(0, 2), 10);
      mm = parseInt(raw.slice(2), 10);
    }
  } else if (/^\d{1,2}$/.test(raw)) {
    hh = parseInt(raw, 10);
    mm = 0;
  } else {
    return '';
  }

  if (Number.isNaN(hh) || Number.isNaN(mm) || mm < 0 || mm > 59) return '';

  if (is24Hour) {
    if (hh < 0 || hh > 23) return '';
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  if (hh < 1 || hh > 12) return '';
  if (meridiem === 'AM') {
    if (hh === 12) hh = 0;
  } else if (hh < 12) {
    hh += 12;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function to12HourParts(hhmm: string): { time: string; meridiem: Meridiem } {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return { time: '12:00', meridiem: 'AM' };
  const hh = parseInt(m[1], 10);
  const mm = m[2];
  const meridiem: Meridiem = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { time: `${String(h12).padStart(2, '0')}:${mm}`, meridiem };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

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
  const [is24Hour, setIs24Hour] = useState(true);
  const [startMeridiem, setStartMeridiem] = useState<Meridiem>(toMeridiem(existing?.startTime ?? '09:00'));
  const [endMeridiem, setEndMeridiem] = useState<Meridiem>(toMeridiem(existing?.endTime ?? '10:20'));
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const switchTimeFormat = (next24Hour: boolean) => {
    if (next24Hour === is24Hour) return;
    const normalizedStart = parseTimeFromMode(startTime, is24Hour, startMeridiem) || (existing?.startTime ?? '09:00');
    const normalizedEnd = parseTimeFromMode(endTime, is24Hour, endMeridiem) || (existing?.endTime ?? '10:20');

    if (next24Hour) {
      setStartTime(normalizedStart);
      setEndTime(normalizedEnd);
    } else {
      const startParts = to12HourParts(normalizedStart);
      const endParts = to12HourParts(normalizedEnd);
      setStartTime(startParts.time);
      setStartMeridiem(startParts.meridiem);
      setEndTime(endParts.time);
      setEndMeridiem(endParts.meridiem);
    }
    setIs24Hour(next24Hour);
  };

  const validate = (): { start: string; end: string } | null => {
    if (!subject.trim()) { Alert.alert('Missing field', 'Please enter a subject.'); return null; }
    if (!room.trim()) { Alert.alert('Missing field', 'Please enter a room.'); return null; }
    if (!teacher.trim()) { Alert.alert('Missing field', 'Please enter a teacher name.'); return null; }
    const normalizedStart = parseTimeFromMode(startTime, is24Hour, startMeridiem);
    const normalizedEnd = parseTimeFromMode(endTime, is24Hour, endMeridiem);
    if (!normalizedStart || !normalizedEnd) {
      Alert.alert('Invalid time', is24Hour ? 'Use HH:MM in 24-hour format (e.g. 14:00).' : 'Use HH:MM with AM/PM (e.g. 02:00 PM).');
      return null;
    }
    if (toMinutes(normalizedEnd) <= toMinutes(normalizedStart)) {
      Alert.alert('Invalid range', 'End time must be later than start time.');
      return null;
    }
    return { start: normalizedStart, end: normalizedEnd };
  };

  const handleSave = async () => {
    const normalized = validate();
    if (!normalized) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    try {
      if (isEdit && existing) {
        await editLecture({ ...existing, day, subject, room, teacher, startTime: normalized.start, endTime: normalized.end });
      } else {
        await addLecture({ day, subject, room, teacher, startTime: normalized.start, endTime: normalized.end, reminderEnabled: 0 });
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

        <View style={styles.modeRow}>
          <Text style={styles.modeLabel}>Time Format</Text>
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[styles.modeChip, is24Hour && styles.modeChipActive]}
              onPress={() => switchTimeFormat(true)}
            >
              <Text style={[styles.modeChipText, is24Hour && styles.modeChipTextActive]}>24H</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeChip, !is24Hour && styles.modeChipActive]}
              onPress={() => switchTimeFormat(false)}
            >
              <Text style={[styles.modeChipText, !is24Hour && styles.modeChipTextActive]}>AM/PM</Text>
            </TouchableOpacity>
          </View>
        </View>

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
              selectTextOnFocus
            />
            {!is24Hour && (
              <View style={styles.meridiemRow}>
                {(['AM', 'PM'] as const).map(mer => (
                  <TouchableOpacity
                    key={`start-${mer}`}
                    style={[styles.meridiemChip, startMeridiem === mer && styles.meridiemChipActive]}
                    onPress={() => setStartMeridiem(mer)}
                  >
                    <Text style={[styles.meridiemText, startMeridiem === mer && styles.meridiemTextActive]}>{mer}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
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
              selectTextOnFocus
            />
            {!is24Hour && (
              <View style={styles.meridiemRow}>
                {(['AM', 'PM'] as const).map(mer => (
                  <TouchableOpacity
                    key={`end-${mer}`}
                    style={[styles.meridiemChip, endMeridiem === mer && styles.meridiemChipActive]}
                    onPress={() => setEndMeridiem(mer)}
                  >
                    <Text style={[styles.meridiemText, endMeridiem === mer && styles.meridiemTextActive]}>{mer}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        <Text style={styles.timeHint}>
          Dialer input: type digits and it formats as HH:MM. Toggle between 24H and AM/PM above.
        </Text>
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
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modeLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 3,
    gap: 4,
  },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  modeChipActive: {
    backgroundColor: Colors.primary,
  },
  modeChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.textSecondary,
  },
  modeChipTextActive: {
    color: Colors.bg,
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
  meridiemRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  meridiemChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  meridiemChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  meridiemText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.textSecondary,
  },
  meridiemTextActive: {
    color: Colors.bg,
  },
  timeHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
