import AsyncStorage from '@react-native-async-storage/async-storage';

export type GpaSubject = {
  id: string;
  name: string;
  gradeOrMarks: string;
  creditHours: number;
};

export type GpaSemester = {
  id: string;
  name: string;
  subjects: GpaSubject[];
  createdAt: string;
  updatedAt: string;
};

export type GpaState = {
  semesters: GpaSemester[];
  previousCgpa: number | null;
  previousCredits: number | null;
  gradingCriteria: GpaCriteriaRange[];
};

export type GpaCriteriaRange = {
  id: string;
  minPercentage: number;
  maxPercentage: number;
  gpa: number;
};

export type SubjectPointsResult = {
  points: number | null;
  creditHours: number;
  qualityPoints: number;
};

export type GpaResult = {
  gpa: number | null;
  percentage: number | null;
  totalCredits: number;
  qualityPoints: number;
  validSubjects: number;
  invalidSubjects: number;
};

const GPA_STORAGE_KEY = 'unischedule_gpa_state_v1';

const LETTER_TO_POINTS: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0,
};

const DEFAULT_GRADING_CRITERIA: GpaCriteriaRange[] = [
  { id: 'default-1', minPercentage: 89.5, maxPercentage: 100, gpa: 4.0 },
  { id: 'default-2', minPercentage: 79.5, maxPercentage: 89.4, gpa: 4.0 },
  { id: 'default-3', minPercentage: 76.5, maxPercentage: 79.4, gpa: 3.66 },
  { id: 'default-4', minPercentage: 73.5, maxPercentage: 76.4, gpa: 3.33 },
  { id: 'default-5', minPercentage: 69.5, maxPercentage: 73.4, gpa: 3.0 },
  { id: 'default-6', minPercentage: 66.5, maxPercentage: 69.4, gpa: 2.66 },
  { id: 'default-7', minPercentage: 63.5, maxPercentage: 66.4, gpa: 2.33 },
  { id: 'default-8', minPercentage: 59.5, maxPercentage: 63.4, gpa: 2.0 },
  { id: 'default-9', minPercentage: 0, maxPercentage: 59.4, gpa: 1.0 },
];

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

export function gradeOrMarksToPoints(input: string): number | null {
  return gradeOrMarksToPointsWithCriteria(input, DEFAULT_GRADING_CRITERIA);
}

export function getDefaultGradingCriteria(): GpaCriteriaRange[] {
  return DEFAULT_GRADING_CRITERIA.map(item => ({ ...item }));
}

function normalizeCriteria(criteria: GpaCriteriaRange[] | null | undefined): GpaCriteriaRange[] {
  const base = Array.isArray(criteria) && criteria.length > 0 ? criteria : getDefaultGradingCriteria();
  return base
    .map((item, idx) => ({
      id: item.id || `criteria-${idx}`,
      minPercentage: Number(item.minPercentage),
      maxPercentage: Number(item.maxPercentage),
      gpa: Number(item.gpa),
    }))
    .filter(
      item =>
        Number.isFinite(item.minPercentage) &&
        Number.isFinite(item.maxPercentage) &&
        Number.isFinite(item.gpa) &&
        item.minPercentage <= item.maxPercentage
    )
    .sort((a, b) => b.minPercentage - a.minPercentage);
}

export function gradeOrMarksToPointsWithCriteria(
  input: string,
  criteria: GpaCriteriaRange[] | null | undefined
): number | null {
  const raw = input.trim().toUpperCase();
  if (!raw) return null;

  if (raw in LETTER_TO_POINTS) return LETTER_TO_POINTS[raw];

  const n = toNumber(raw);
  if (n == null) return null;

  if (n >= 0 && n <= 4) return n;

  if (n < 0 || n > 100) return null;
  const normalizedCriteria = normalizeCriteria(criteria);
  const matched = normalizedCriteria.find(
    range => n >= range.minPercentage - 1e-9 && n <= range.maxPercentage + 1e-9
  );
  return matched ? matched.gpa : null;
}

export function gradeOrMarksToPercentageWithCriteria(
  input: string,
  criteria: GpaCriteriaRange[] | null | undefined
): number | null {
  const raw = input.trim().toUpperCase();
  if (!raw) return null;

  const n = toNumber(raw);
  if (n != null) {
    if (n >= 0 && n <= 100) return n;
    if (n >= 0 && n <= 4) {
      const normalized = normalizeCriteria(criteria);
      const match = normalized.find(range => range.gpa === n);
      const nearest =
        match ||
        normalized.reduce((best, range) => {
          return Math.abs(range.gpa - n) < Math.abs(best.gpa - n) ? range : best;
        }, normalized[0]);
      return nearest ? (nearest.minPercentage + nearest.maxPercentage) / 2 : null;
    }
  }

  const letterPoints = LETTER_TO_POINTS[raw];
  if (letterPoints != null) {
    const normalized = normalizeCriteria(criteria);
    const match = normalized.find(range => range.gpa === letterPoints);
    if (match) return (match.minPercentage + match.maxPercentage) / 2;
  }

  return null;
}

export function calculateSubjectPoints(
  subject: GpaSubject,
  criteria: GpaCriteriaRange[] | null | undefined
): SubjectPointsResult {
  const creditHours = Number(subject.creditHours);
  const points = gradeOrMarksToPointsWithCriteria(subject.gradeOrMarks, criteria);
  if (!Number.isFinite(creditHours) || creditHours <= 0 || points == null) {
    return { points: null, creditHours: 0, qualityPoints: 0 };
  }
  return { points, creditHours, qualityPoints: points * creditHours };
}

export function calculateSemesterGpa(
  semester: GpaSemester,
  criteria: GpaCriteriaRange[] | null | undefined
): GpaResult {
  let qualityPoints = 0;
  let totalCredits = 0;
  let percentagePoints = 0;
  let percentageCredits = 0;
  let validSubjects = 0;
  let invalidSubjects = 0;

  for (const subject of semester.subjects) {
    const r = calculateSubjectPoints(subject, criteria);
    if (r.points == null) {
      invalidSubjects += 1;
      continue;
    }
    validSubjects += 1;
    qualityPoints += r.qualityPoints;
    totalCredits += r.creditHours;

    const pct = gradeOrMarksToPercentageWithCriteria(subject.gradeOrMarks, criteria);
    if (pct != null && r.creditHours > 0) {
      percentagePoints += pct * r.creditHours;
      percentageCredits += r.creditHours;
    }
  }

  const gpa = totalCredits > 0 ? roundTo(qualityPoints / totalCredits, 2) : null;
  const percentage = percentageCredits > 0 ? roundTo(percentagePoints / percentageCredits, 2) : null;

  return {
    gpa,
    percentage,
    totalCredits,
    qualityPoints,
    validSubjects,
    invalidSubjects,
  };
}

export function calculateOverallCgpa(
  semesters: GpaSemester[],
  previousCgpa: number | null,
  previousCredits: number | null,
  criteria: GpaCriteriaRange[] | null | undefined
): { cgpa: number | null; totalCredits: number; qualityPoints: number } {
  let totalCredits = 0;
  let qualityPoints = 0;

  const prevCgpaNum = toNumber(previousCgpa);
  const prevCreditsNum = toNumber(previousCredits);
  if (
    prevCgpaNum != null &&
    prevCreditsNum != null &&
    prevCreditsNum > 0 &&
    prevCgpaNum >= 0 &&
    prevCgpaNum <= 4
  ) {
    totalCredits += prevCreditsNum;
    qualityPoints += prevCgpaNum * prevCreditsNum;
  }

  for (const semester of semesters) {
    const sem = calculateSemesterGpa(semester, criteria);
    totalCredits += sem.totalCredits;
    qualityPoints += sem.qualityPoints;
  }

  return {
    cgpa: totalCredits > 0 ? qualityPoints / totalCredits : null,
    totalCredits,
    qualityPoints,
  };
}

export async function loadGpaState(): Promise<GpaState> {
  const raw = await AsyncStorage.getItem(GPA_STORAGE_KEY);
  if (!raw) {
    return {
      semesters: [],
      previousCgpa: null,
      previousCredits: null,
      gradingCriteria: getDefaultGradingCriteria(),
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GpaState>;
    const semesters = Array.isArray(parsed.semesters)
      ? parsed.semesters.map((sem, idx) => ({
          id: String(sem?.id ?? `sem-${idx}`),
          name: String(sem?.name ?? `Semester ${idx + 1}`),
          subjects: Array.isArray(sem?.subjects)
            ? sem.subjects.map((sub, subIdx) => ({
                id: String(sub?.id ?? `sub-${idx}-${subIdx}`),
                name: String(sub?.name ?? ''),
                gradeOrMarks: String(sub?.gradeOrMarks ?? ''),
                creditHours: Number(sub?.creditHours ?? 0),
              }))
            : [],
          createdAt: String(sem?.createdAt ?? new Date().toISOString()),
          updatedAt: String(sem?.updatedAt ?? new Date().toISOString()),
        }))
      : [];

    return {
      semesters,
      previousCgpa: toNumber(parsed.previousCgpa),
      previousCredits: toNumber(parsed.previousCredits),
      gradingCriteria: normalizeCriteria(parsed.gradingCriteria as GpaCriteriaRange[] | null | undefined),
    };
  } catch {
    return {
      semesters: [],
      previousCgpa: null,
      previousCredits: null,
      gradingCriteria: getDefaultGradingCriteria(),
    };
  }
}

export async function saveGpaState(state: GpaState): Promise<void> {
  await AsyncStorage.setItem(
    GPA_STORAGE_KEY,
    JSON.stringify({
      ...state,
      gradingCriteria: normalizeCriteria(state.gradingCriteria),
    })
  );
}
