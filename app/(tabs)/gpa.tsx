import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Platform,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  ScrollView,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useTabScreenViewAnalytics } from '@/lib/usageAnalytics';
import {
  calculateOverallCgpa,
  calculateSemesterGpa,
  GpaCriteriaRange,
  GpaSemester,
  gradeOrMarksToPointsWithCriteria,
  loadGpaState,
  saveGpaState,
} from '@/lib/gpa';

type SubjectDraft = {
  id: string;
  name: string;
  gradeOrMarks: string;
  creditHours: string;
};

function formatPoint(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(1)}%`;
}

function createSubjectDraft(): SubjectDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    gradeOrMarks: '',
    creditHours: '',
  };
}

export default function GpaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useTabScreenViewAnalytics('GPA', 'GpaScreen');
  const { height: windowHeight } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [semesters, setSemesters] = useState<GpaSemester[]>([]);
  const [gradingCriteria, setGradingCriteria] = useState<GpaCriteriaRange[]>([]);
  const [previousCgpaInput, setPreviousCgpaInput] = useState('');
  const [previousCreditsInput, setPreviousCreditsInput] = useState('');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingSemesterId, setEditingSemesterId] = useState<string | null>(null);
  const [semesterName, setSemesterName] = useState('');
  const [subjects, setSubjects] = useState<SubjectDraft[]>([createSubjectDraft()]);
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 + 24 : insets.bottom + 84;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadGpaState();
      setSemesters(state.semesters);
      setGradingCriteria(state.gradingCriteria);
      setPreviousCgpaInput(state.previousCgpa != null ? String(state.previousCgpa) : '');
      setPreviousCreditsInput(state.previousCredits != null ? String(state.previousCredits) : '');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const closeSheet = useCallback(() => {
    Animated.timing(sheetTranslateY, {
      toValue: windowHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setSheetOpen(false);
      setEditingSemesterId(null);
      setSemesterName('');
      setSubjects([createSubjectDraft()]);
    });
  }, [sheetTranslateY, windowHeight]);

  const openAddSemester = useCallback(() => {
    setEditingSemesterId(null);
    setSemesterName(`Semester ${semesters.length + 1}`);
    setSubjects([createSubjectDraft()]);
    setSheetOpen(true);
  }, [semesters.length]);

  const openEditSemester = useCallback((semester: GpaSemester) => {
    setEditingSemesterId(semester.id);
    setSemesterName(semester.name);
    setSubjects(
      semester.subjects.length > 0
        ? semester.subjects.map(subject => ({
            id: subject.id,
            name: subject.name,
            gradeOrMarks: subject.gradeOrMarks,
            creditHours: String(subject.creditHours),
          }))
        : [createSubjectDraft()]
    );
    setSheetOpen(true);
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          sheetOpen &&
          gesture.dy > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          sheetTranslateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 1.1) {
            closeSheet();
            return;
          }
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 25,
            stiffness: 260,
            mass: 0.8,
            useNativeDriver: true,
          }).start();
        },
      }),
    [closeSheet, sheetOpen, sheetTranslateY]
  );

  React.useEffect(() => {
    if (!sheetOpen) {
      sheetTranslateY.setValue(windowHeight);
      return;
    }
    sheetTranslateY.setValue(windowHeight);
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      damping: 25,
      stiffness: 260,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [sheetOpen, sheetTranslateY, windowHeight]);

  React.useEffect(() => {
    if (!sheetOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSheet();
      return true;
    });
    return () => sub.remove();
  }, [closeSheet, sheetOpen]);

  const overall = useMemo(() => {
    const prevCgpa = previousCgpaInput.trim() ? Number(previousCgpaInput.trim()) : null;
    const prevCredits = previousCreditsInput.trim() ? Number(previousCreditsInput.trim()) : null;
    return calculateOverallCgpa(semesters, prevCgpa, prevCredits, gradingCriteria);
  }, [semesters, previousCgpaInput, previousCreditsInput, gradingCriteria]);

  const savePreviousData = useCallback(async () => {
    const cgpaRaw = previousCgpaInput.trim();
    const creditsRaw = previousCreditsInput.trim();
    const cgpa = cgpaRaw ? Number(cgpaRaw) : null;
    const credits = creditsRaw ? Number(creditsRaw) : null;

    if ((cgpaRaw && Number.isNaN(cgpa as number)) || (creditsRaw && Number.isNaN(credits as number))) {
      Alert.alert('Invalid values', 'Use numeric values for Previous CGPA and Credits.');
      return;
    }
    if (cgpa != null && (cgpa < 0 || cgpa > 4)) {
      Alert.alert('Invalid CGPA', 'Previous CGPA must be between 0.00 and 4.00.');
      return;
    }
    if (credits != null && credits < 0) {
      Alert.alert('Invalid Credits', 'Previous completed credits cannot be negative.');
      return;
    }

    await saveGpaState({
      semesters,
      previousCgpa: cgpa,
      previousCredits: credits,
      gradingCriteria,
    });
  }, [previousCgpaInput, previousCreditsInput, semesters, gradingCriteria]);

  const addSubjectDraft = useCallback(() => {
    setSubjects(prev => [...prev, createSubjectDraft()]);
  }, []);

  const updateSubjectDraft = useCallback((id: string, patch: Partial<SubjectDraft>) => {
    setSubjects(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSubjectDraft = useCallback((id: string) => {
    setSubjects(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)));
  }, []);

  const saveSemester = useCallback(async () => {
    const name = semesterName.trim();
    if (!name) {
      Alert.alert('Semester name required', 'Please enter a semester name.');
      return;
    }

    const validSubjects = subjects
      .map(subject => ({
        id: subject.id,
        name: subject.name.trim(),
        gradeOrMarks: subject.gradeOrMarks.trim(),
        creditHours: Number(subject.creditHours.trim()),
      }))
      .filter(subject => subject.name || subject.gradeOrMarks || String(subject.creditHours || '').trim());

    if (validSubjects.length === 0) {
      Alert.alert('Add subjects', 'Please add at least one subject.');
      return;
    }

    for (const subject of validSubjects) {
      if (!subject.name || !subject.gradeOrMarks || !Number.isFinite(subject.creditHours) || subject.creditHours <= 0) {
        Alert.alert('Incomplete subject', 'Each subject needs name, marks/grade, and valid credit hours.');
        return;
      }
      if (gradeOrMarksToPointsWithCriteria(subject.gradeOrMarks, gradingCriteria) == null) {
        Alert.alert('Invalid marks/grade', `Invalid value for ${subject.name}. Use marks (0-100), GPA (0-4), or letter grade (A, B+, etc).`);
        return;
      }
    }

    const now = new Date().toISOString();
    const next: GpaSemester[] = editingSemesterId
      ? semesters.map(semester =>
          semester.id === editingSemesterId
            ? {
                ...semester,
                name,
                subjects: validSubjects,
                updatedAt: now,
              }
            : semester
        )
      : [
          ...semesters,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            subjects: validSubjects,
            createdAt: now,
            updatedAt: now,
          },
        ];

    setSemesters(next);
    await saveGpaState({
      semesters: next,
      previousCgpa: previousCgpaInput.trim() ? Number(previousCgpaInput.trim()) : null,
      previousCredits: previousCreditsInput.trim() ? Number(previousCreditsInput.trim()) : null,
      gradingCriteria,
    });
    closeSheet();
  }, [closeSheet, editingSemesterId, gradingCriteria, previousCgpaInput, previousCreditsInput, semesterName, semesters, subjects]);

  const deleteSemester = useCallback((semesterId: string) => {
    const target = semesters.find(semester => semester.id === semesterId);
    if (!target) return;
    Alert.alert('Delete Semester', `Remove "${target.name}" and its subjects?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = semesters.filter(semester => semester.id !== semesterId);
          setSemesters(next);
          await saveGpaState({
            semesters: next,
            previousCgpa: previousCgpaInput.trim() ? Number(previousCgpaInput.trim()) : null,
            previousCredits: previousCreditsInput.trim() ? Number(previousCreditsInput.trim()) : null,
            gradingCriteria,
          });
        },
      },
    ]);
  }, [gradingCriteria, previousCgpaInput, previousCreditsInput, semesters]);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>GPA Calculator</Text>
          <Text style={styles.subtitle}>Track semester GPA and overall CGPA</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/gpa-settings')}>
            <Ionicons name="settings-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtn} onPress={openAddSemester}>
            <Ionicons name="add" size={22} color={Colors.bg} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.cgpaCard}>
        <Text style={styles.cgpaLabel}>Overall CGPA</Text>
        <Text style={styles.cgpaValue}>{formatPoint(overall.cgpa)}</Text>
        <Text style={styles.cgpaMeta}>Total Credits Counted: {overall.totalCredits.toFixed(1)}</Text>
      </View>

      <View style={styles.shortcutCard}>
        <Text style={styles.shortcutTitle}>Optional Previous CGPA Shortcut</Text>
        <Text style={styles.shortcutDesc}>Use this if you do not want to add all past semester subjects.</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            value={previousCgpaInput}
            onChangeText={setPreviousCgpaInput}
            placeholder="Previous CGPA"
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            value={previousCreditsInput}
            onChangeText={setPreviousCreditsInput}
            placeholder="Previous Credits"
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
          />
        </View>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => { void savePreviousData(); }}>
          <Text style={styles.secondaryBtnText}>Save Previous Data</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : (
        <FlatList
          data={semesters}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10, paddingTop: 6 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="calculator-outline" size={44} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No semesters added</Text>
              <Text style={styles.emptyText}>Tap + to add your first semester.</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const result = calculateSemesterGpa(item, gradingCriteria);
            return (
              <View style={styles.semCard}>
                <TouchableOpacity
                  style={styles.semBody}
                  activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/gpa-semester/[id]', params: { id: item.id } })}
                >
                  <View>
                    <Text style={styles.semTitle}>{item.name || `Semester ${index + 1}`}</Text>
                    <Text style={styles.semMeta}>
                      {item.subjects.length} subjects
                    </Text>
                  </View>
                  <View style={styles.semRight}>
                    <View>
                      <Text style={styles.semGpaLabel}>GPA</Text>
                      <Text style={styles.semGpaValue}>{formatPoint(result.gpa)}</Text>
                    </View>
                    <View>
                      <Text style={styles.semGpaLabel}>Average %</Text>
                      <Text style={styles.semGpaValue}>{formatPercent(result.percentage)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={styles.semActions}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEditSemester(item)}>
                    <Ionicons name="pencil-outline" size={16} color={Colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => deleteSemester(item.id)}>
                    <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {sheetOpen && (
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet} />
          <Animated.View style={[styles.sheetContainer, { transform: [{ translateY: sheetTranslateY }] }]}>
            <KeyboardAvoidingView style={styles.sheetKeyboardWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={[styles.sheetHeader, { paddingTop: insets.top + 8 }]}>
                <View style={styles.grabberTouchArea} {...panResponder.panHandlers}>
                  <View style={styles.grabber} />
                </View>
                <View style={styles.formHeaderRow}>
                  <Text style={styles.formTitle}>{editingSemesterId ? 'Edit Semester' : 'Add Semester'}</Text>
                  <TouchableOpacity onPress={closeSheet} hitSlop={8}>
                    <Ionicons name="close" size={20} color={Colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <ScrollView
                style={styles.formScroll}
                contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
              >
                <TextInput
                  style={styles.input}
                  value={semesterName}
                  onChangeText={setSemesterName}
                  placeholder="Semester Name (e.g. Semester 3)"
                  placeholderTextColor={Colors.textMuted}
                />

                <Text style={styles.sectionLabel}>Subjects</Text>
                {subjects.map((subject, index) => (
                  <View key={subject.id} style={styles.subjectCard}>
                    <View style={styles.subjectHeader}>
                      <Text style={styles.subjectTitle}>Subject {index + 1}</Text>
                      <TouchableOpacity onPress={() => removeSubjectDraft(subject.id)} disabled={subjects.length <= 1}>
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={subjects.length <= 1 ? Colors.textMuted : Colors.danger}
                        />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={subject.name}
                      onChangeText={v => updateSubjectDraft(subject.id, { name: v })}
                      placeholder="Subject Name"
                      placeholderTextColor={Colors.textMuted}
                    />
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, styles.rowInput]}
                        value={subject.gradeOrMarks}
                        onChangeText={v => updateSubjectDraft(subject.id, { gradeOrMarks: v })}
                        placeholder="Marks or Grade"
                        placeholderTextColor={Colors.textMuted}
                        autoCapitalize="characters"
                      />
                      <TextInput
                        style={[styles.input, styles.rowInput]}
                        value={subject.creditHours}
                        onChangeText={v => updateSubjectDraft(subject.id, { creditHours: v })}
                        placeholder="Credit Hours"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                ))}

                <TouchableOpacity style={styles.secondaryBtn} onPress={addSubjectDraft}>
                  <Ionicons name="add" size={16} color={Colors.primary} />
                  <Text style={styles.secondaryBtnText}>Add Subject</Text>
                </TouchableOpacity>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={closeSheet}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={() => { void saveSemester(); }}>
                    <Ionicons name="checkmark" size={18} color={Colors.bg} />
                    <Text style={styles.saveText}>{editingSemesterId ? 'Update Semester' : 'Save Semester'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </Animated.View>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: Colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cgpaCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  cgpaLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  cgpaValue: {
    color: Colors.primary,
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    marginTop: 4,
  },
  cgpaMeta: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  shortcutCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 8,
  },
  shortcutTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  shortcutDesc: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  semCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    gap: 10,
  },
  semBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  semActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  semTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  semMeta: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 3,
  },
  semRight: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
  },
  semGpaLabel: {
    color: Colors.textMuted,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  semGpaValue: {
    color: Colors.primary,
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginTop: 1,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    textAlign: 'center',
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
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowInput: {
    flex: 1,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  subjectCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  subjectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subjectTitle: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
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
    flexDirection: 'row',
    gap: 6,
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheetContainer: {
    height: '100%',
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  sheetKeyboardWrap: {
    flex: 1,
  },
  sheetHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  grabberTouchArea: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.surface3,
  },
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface2,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
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
