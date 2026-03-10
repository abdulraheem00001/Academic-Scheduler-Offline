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
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  getDefaultGradingCriteria,
  GpaCriteriaRange,
  loadGpaState,
  saveGpaState,
} from '@/lib/gpa';

type CriteriaDraft = {
  id: string;
  minPercentage: string;
  maxPercentage: string;
  gpa: string;
};

type CriteriaAnalysis = {
  parsed: GpaCriteriaRange[];
  errors: string[];
  gaps: string[];
  overlaps: string[];
  isCompleteCoverage: boolean;
};

function toDraft(criteria: GpaCriteriaRange[]): CriteriaDraft[] {
  return criteria.map(item => ({
    id: item.id,
    minPercentage: String(item.minPercentage),
    maxPercentage: String(item.maxPercentage),
    gpa: String(item.gpa),
  }));
}

function analyzeCriteria(rows: CriteriaDraft[]): CriteriaAnalysis {
  const parsed: GpaCriteriaRange[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const min = Number(row.minPercentage.trim());
    const max = Number(row.maxPercentage.trim());
    const gpa = Number(row.gpa.trim());
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(gpa)) {
      errors.push('Every row must have numeric Min, Max, and GPA values.');
      continue;
    }
    if (min < 0 || max > 100 || min > max) {
      errors.push(`Invalid range: ${row.minPercentage}-${row.maxPercentage}.`);
      continue;
    }
    if (gpa < 0 || gpa > 4) {
      errors.push(`Invalid GPA value (${row.gpa}). Use 0.00 to 4.00.`);
      continue;
    }
    parsed.push({
      id: row.id,
      minPercentage: min,
      maxPercentage: max,
      gpa,
    });
  }

  const sorted = [...parsed].sort((a, b) => a.minPercentage - b.minPercentage);
  const overlaps: string[] = [];
  const gaps: string[] = [];
  const EPS = 1e-9;

  if (sorted.length > 0) {
    if (sorted[0].minPercentage > 0 + EPS) {
      gaps.push(`0-${Math.max(0, sorted[0].minPercentage - 1)}`);
    }
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (next.minPercentage <= current.maxPercentage + EPS) {
        overlaps.push(`${current.minPercentage}-${current.maxPercentage} with ${next.minPercentage}-${next.maxPercentage}`);
      } else if (next.minPercentage > current.maxPercentage + 1 + EPS) {
        gaps.push(`${current.maxPercentage + 1}-${next.minPercentage - 1}`);
      }
    }
    if (sorted[sorted.length - 1].maxPercentage < 100 - EPS) {
      gaps.push(`${sorted[sorted.length - 1].maxPercentage + 1}-100`);
    }
  } else {
    gaps.push('0-100');
  }

  return {
    parsed,
    errors,
    gaps,
    overlaps,
    isCompleteCoverage: errors.length === 0 && overlaps.length === 0 && gaps.length === 0,
  };
}

export default function GpaSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<CriteriaDraft[]>([]);
  const [loading, setLoading] = useState(true);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom + 24;
  const analysis = useMemo(() => analyzeCriteria(rows), [rows]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const state = await loadGpaState();
      setRows(toDraft(state.gradingCriteria));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const addRow = useCallback(() => {
    setRows(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        minPercentage: '',
        maxPercentage: '',
        gpa: '',
      },
    ]);
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<CriteriaDraft>) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows(prev => prev.filter(row => row.id !== id));
  }, []);

  const resetDefault = useCallback(() => {
    setRows(toDraft(getDefaultGradingCriteria()));
  }, []);

  const saveCriteria = useCallback(async () => {
    if (rows.length === 0) {
      Alert.alert('No criteria', 'Add at least one grading range.');
      return;
    }

    if (analysis.errors.length > 0) {
      Alert.alert('Invalid values', analysis.errors[0]);
      return;
    }
    if (analysis.overlaps.length > 0) {
      Alert.alert('Overlapping ranges', `Fix overlap: ${analysis.overlaps[0]}.`);
      return;
    }
    if (analysis.gaps.length > 0) {
      Alert.alert('Coverage gap', `Your scale does not fully cover 0-100. Missing range around ${analysis.gaps[0]}.`);
      return;
    }

    const state = await loadGpaState();
    await saveGpaState({
      ...state,
      gradingCriteria: analysis.parsed,
    });
    Alert.alert('Saved', 'GPA grading criteria updated.');
    router.back();
  }, [analysis, router, rows.length]);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>GPA Calculation Settings</Text>
        <TouchableOpacity onPress={resetDefault} style={styles.iconBtn}>
          <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10 }}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Custom Grading Criteria</Text>
          <Text style={styles.infoText}>
            Different universities use different grading systems. You can customize the percentage-to-GPA conversion here according to your university&apos;s rules.
          </Text>
          <View style={[styles.coverageBadge, analysis.isCompleteCoverage ? styles.coverageOk : styles.coverageIssue]}>
            <Ionicons
              name={analysis.isCompleteCoverage ? 'checkmark-circle-outline' : 'warning-outline'}
              size={14}
              color={analysis.isCompleteCoverage ? Colors.success : Colors.danger}
            />
            <Text style={[styles.coverageText, analysis.isCompleteCoverage ? styles.coverageTextOk : styles.coverageTextIssue]}>
              {analysis.isCompleteCoverage
                ? 'Coverage checker: complete (0-100 fully covered)'
                : 'Coverage checker: incomplete, fix errors/gaps before saving'}
            </Text>
          </View>
          {!analysis.isCompleteCoverage && analysis.gaps.length > 0 && (
            <Text style={styles.coverageHint}>Missing range example: {analysis.gaps[0]}</Text>
          )}
          {!analysis.isCompleteCoverage && analysis.overlaps.length > 0 && (
            <Text style={styles.coverageHint}>Overlap example: {analysis.overlaps[0]}</Text>
          )}
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { flex: 1 }]}>Min %</Text>
          <Text style={[styles.tableHeaderText, { flex: 1 }]}>Max %</Text>
          <Text style={[styles.tableHeaderText, { flex: 1 }]}>GPA</Text>
          <View style={{ width: 28 }} />
        </View>

        {loading ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        ) : (
          rows.map(row => (
            <View key={row.id} style={styles.criteriaRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={row.minPercentage}
                onChangeText={v => updateRow(row.id, { minPercentage: v })}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={row.maxPercentage}
                onChangeText={v => updateRow(row.id, { maxPercentage: v })}
                placeholder="100"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={row.gpa}
                onChangeText={v => updateRow(row.id, { gpa: v })}
                placeholder="4.0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity onPress={() => removeRow(row.id)} style={styles.trashBtn}>
                <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}

        <TouchableOpacity style={styles.secondaryBtn} onPress={addRow}>
          <Ionicons name="add" size={16} color={Colors.primary} />
          <Text style={styles.secondaryBtnText}>Add Range</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={() => { void saveCriteria(); }}>
          <Ionicons name="checkmark" size={18} color={Colors.bg} />
          <Text style={styles.saveText}>Save Criteria</Text>
        </TouchableOpacity>
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
    gap: 8,
  },
  title: {
    color: Colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    flex: 1,
    textAlign: 'center',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  infoTitle: {
    color: Colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  infoText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  coverageBadge: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coverageOk: {
    borderColor: 'rgba(34,197,94,0.45)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  coverageIssue: {
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  coverageText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    flex: 1,
  },
  coverageTextOk: {
    color: Colors.success,
  },
  coverageTextIssue: {
    color: Colors.danger,
  },
  coverageHint: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  tableHeaderText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  criteriaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  trashBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface2,
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
    marginTop: 4,
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
    marginTop: 2,
  },
  saveText: {
    color: Colors.bg,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  emptyWrap: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
