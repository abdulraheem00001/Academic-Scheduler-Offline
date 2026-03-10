import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  GpaCriteriaRange,
  calculateSemesterGpa,
  calculateSubjectPoints,
  GpaSemester,
  gradeOrMarksToPointsWithCriteria,
  loadGpaState,
  saveGpaState,
} from '@/lib/gpa';

function formatPoint(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toFixed(2);
}

export default function SemesterDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [semester, setSemester] = useState<GpaSemester | null>(null);
  const [gradingCriteria, setGradingCriteria] = useState<GpaCriteriaRange[]>([]);
  const [semesterNameInput, setSemesterNameInput] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [gradeOrMarks, setGradeOrMarks] = useState('');
  const [creditHours, setCreditHours] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom + 24;

  const loadSemester = useCallback(async () => {
    const state = await loadGpaState();
    const found = state.semesters.find(s => s.id === String(id));
    setSemester(found ?? null);
    setGradingCriteria(state.gradingCriteria);
    setSemesterNameInput(found?.name ?? '');
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void loadSemester();
    }, [loadSemester])
  );

  const saveSemesterName = useCallback(async () => {
    if (!semester) return;
    const nextName = semesterNameInput.trim();
    if (!nextName) {
      Alert.alert('Name required', 'Semester name cannot be empty.');
      return;
    }
    const state = await loadGpaState();
    const nextSemesters = state.semesters.map(s =>
      s.id === semester.id
        ? { ...s, name: nextName, updatedAt: new Date().toISOString() }
        : s
    );
    await saveGpaState({ ...state, semesters: nextSemesters });
    await loadSemester();
  }, [loadSemester, semester, semesterNameInput]);

  const addSubject = useCallback(async () => {
    if (!semester) return;
    const name = subjectName.trim();
    const grade = gradeOrMarks.trim();
    const credits = Number(creditHours.trim());

    if (!name || !grade || !Number.isFinite(credits) || credits <= 0) {
      Alert.alert('Incomplete subject', 'Add subject name, marks/grade, and valid credit hours.');
      return;
    }
    if (gradeOrMarksToPointsWithCriteria(grade, gradingCriteria) == null) {
      Alert.alert('Invalid marks/grade', 'Use marks (0-100), GPA (0-4), or letter grade (A, B+, etc).');
      return;
    }

    const state = await loadGpaState();
    const nextSemesters = state.semesters.map(s => {
      if (s.id !== semester.id) return s;
      return {
        ...s,
        subjects: [
          ...s.subjects,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            gradeOrMarks: grade,
            creditHours: credits,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    });

    await saveGpaState({ ...state, semesters: nextSemesters });
    setSubjectName('');
    setGradeOrMarks('');
    setCreditHours('');
    await loadSemester();
  }, [creditHours, gradeOrMarks, gradingCriteria, loadSemester, semester, subjectName]);

  const removeSubject = useCallback(async (subjectId: string) => {
    if (!semester) return;
    const state = await loadGpaState();
    const nextSemesters = state.semesters.map(s => {
      if (s.id !== semester.id) return s;
      return {
        ...s,
        subjects: s.subjects.filter(sub => sub.id !== subjectId),
        updatedAt: new Date().toISOString(),
      };
    });
    await saveGpaState({ ...state, semesters: nextSemesters });
    await loadSemester();
  }, [loadSemester, semester]);

  const result = useMemo(
    () => (semester ? calculateSemesterGpa(semester, gradingCriteria) : null),
    [gradingCriteria, semester]
  );

  if (!semester) {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Semester Details</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Semester not found.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Semester Details</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10 }}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Semester Name</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={semesterNameInput}
              onChangeText={setSemesterNameInput}
              placeholder="Semester Name"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => { void saveSemesterName(); }}>
              <Text style={styles.secondaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.meta}>Semester GPA: {formatPoint(result?.gpa ?? null)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Subjects</Text>
          {semester.subjects.length === 0 ? (
            <Text style={styles.emptyText}>No subjects in this semester yet.</Text>
          ) : (
            semester.subjects.map(sub => {
              const subCalc = calculateSubjectPoints(sub, gradingCriteria);
              return (
                <View key={sub.id} style={styles.subjectRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subjectName}>{sub.name}</Text>
                    <Text style={styles.subjectMeta}>
                      {sub.gradeOrMarks} · {sub.creditHours} CH · GP {formatPoint(subCalc.points)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { void removeSubject(sub.id); }}>
                    <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Add Subject</Text>
          <TextInput
            style={styles.input}
            value={subjectName}
            onChangeText={setSubjectName}
            placeholder="Subject Name"
            placeholderTextColor={Colors.textMuted}
          />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={gradeOrMarks}
              onChangeText={setGradeOrMarks}
              placeholder="Marks or Grade"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={creditHours}
              onChangeText={setCreditHours}
              placeholder="Credit Hours"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity style={styles.saveBtn} onPress={() => { void addSubject(); }}>
            <Ionicons name="add" size={17} color={Colors.bg} />
            <Text style={styles.saveText}>Add Subject</Text>
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    color: Colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
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
  meta: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  subjectRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: Colors.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subjectName: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  subjectMeta: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    textAlign: 'center',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: Colors.primaryDim,
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
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
