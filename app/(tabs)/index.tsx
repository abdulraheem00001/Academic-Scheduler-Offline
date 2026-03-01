import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Pressable,
  Switch,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
  FadeIn,
  FadeOut,
  SlideInRight,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSchedule } from '@/context/ScheduleContext';
import { Lecture } from '@/lib/database';
import Colors from '@/constants/colors';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL: Record<string, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
  Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

function getTodayShort(): string {
  const d = new Date().getDay();
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d];
}

function timeToMinutes(t: string): number {
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function getCurrentLecture(lectures: Lecture[], day: string, now = new Date()): Lecture | null {
  const today = getTodayShort();
  if (DAY_SHORT[day] !== today && day !== DAY_FULL[today]) return null;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return lectures.find(l => {
    const start = timeToMinutes(l.startTime);
    const end = timeToMinutes(l.endTime);
    return nowMins >= start && nowMins < end;
  }) ?? null;
}

function getTimeRemaining(lecture: Lecture): string {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const endMins = timeToMinutes(lecture.endTime);
  const diff = endMins - nowMins;
  if (diff <= 0) return '0 min left';
  if (diff >= 60) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${diff} min left`;
}

function dayToJsIndex(day: string): number {
  const dayName = DAY_FULL[day] ?? day;
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[dayName] ?? 0;
}

function formatTimeLeft(totalMs: number): string {
  if (totalMs <= 0) return 'Starting now';
  const totalSeconds = Math.floor(totalMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs}s left`;
  }

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

function getNextLecture(lectures: Lecture[], now = new Date()): { lecture: Lecture; msLeft: number; startsAt: Date } | null {
  if (lectures.length === 0) return null;

  const nowDay = now.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nowMs = now.getTime();

  let best: { lecture: Lecture; msLeft: number; startsAt: Date } | null = null;

  for (const lecture of lectures) {
    const lectureDay = dayToJsIndex(lecture.day);
    const startMins = timeToMinutes(lecture.startTime);

    let dayOffset = lectureDay - nowDay;
    if (dayOffset < 0 || (dayOffset === 0 && startMins <= nowMins)) {
      dayOffset += 7;
    }

    const startsAt = new Date(now);
    startsAt.setDate(now.getDate() + dayOffset);
    startsAt.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
    const msLeft = startsAt.getTime() - nowMs;

    if (!best || msLeft < best.msLeft) {
      const startsAt = new Date(now);
      startsAt.setDate(now.getDate() + dayOffset);
      startsAt.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
      best = { lecture, msLeft, startsAt };
    }
  }

  return best;
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function GlowingBorder({ children }: { children: React.ReactNode }) {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [glow]);

  const animStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(212, 175, 55, ${interpolate(glow.value, [0, 1], [0.4, 1])})`,
    shadowOpacity: interpolate(glow.value, [0, 1], [0.3, 0.9]),
    shadowRadius: interpolate(glow.value, [0, 1], [8, 20]),
  }));

  return (
    <Animated.View style={[styles.glowBorder, animStyle]}>
      {children}
    </Animated.View>
  );
}

function LectureCard({ lecture, isCurrent, onEdit, onDelete, onToggleReminder }: {
  lecture: Lecture;
  isCurrent: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleReminder: (v: boolean) => void;
}) {
  const [timeLeft, setTimeLeft] = useState(() => isCurrent ? getTimeRemaining(lecture) : '');

  useEffect(() => {
    if (!isCurrent) return;
    setTimeLeft(getTimeRemaining(lecture));
    const iv = setInterval(() => setTimeLeft(getTimeRemaining(lecture)), 30000);
    return () => clearInterval(iv);
  }, [isCurrent, lecture]);

  const content = (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={[styles.card, isCurrent && styles.cardCurrent]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeText}>{formatTime(lecture.startTime)}</Text>
          <View style={styles.timeLine} />
          <Text style={styles.timeText}>{formatTime(lecture.endTime)}</Text>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={[styles.subject, isCurrent && styles.subjectCurrent]} numberOfLines={2}>
              {lecture.subject}
            </Text>
            {isCurrent && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>{timeLeft}</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{lecture.room}</Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="person-outline" size={13} color={Colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{lecture.teacher}</Text>
          </View>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={styles.reminderRow}>
          <Ionicons name="notifications-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.reminderLabel}>Reminder</Text>
          <Switch
            value={!!lecture.reminderEnabled}
            onValueChange={onToggleReminder}
            trackColor={{ false: Colors.surface3, true: Colors.primaryDim }}
            thumbColor={lecture.reminderEnabled ? Colors.primary : Colors.textMuted}
            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
          />
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={onEdit} style={styles.actionBtn} hitSlop={8}>
            <Ionicons name="pencil-outline" size={16} color={Colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.actionBtn} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );

  if (isCurrent) {
    return <GlowingBorder>{content}</GlowingBorder>;
  }
  return content;
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const { lectures, loading, removeLecture, toggleLectureReminder } = useSchedule();
  const [selectedDay, setSelectedDay] = useState(getTodayShort());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const now = new Date(nowMs);
  const filtered = lectures.filter(l => DAY_SHORT[l.day] === selectedDay || l.day === DAY_FULL[selectedDay]);
  const currentLecture = getCurrentLecture(filtered, DAY_FULL[selectedDay], now);
  const nextLecture = getNextLecture(lectures, now);

  const handleDayPress = useCallback((day: string) => {
    Haptics.selectionAsync();
    setSelectedDay(day);
  }, []);

  const handleDelete = useCallback((id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete Lecture', 'Remove this lecture from your schedule?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeLecture(id) },
    ]);
  }, [removeLecture]);

  const handleToggleReminder = useCallback((id: number, v: boolean) => {
    Haptics.selectionAsync();
    toggleLectureReminder(id, v);
  }, [toggleLectureReminder]);

  const todayShort = getTodayShort();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 84 : 90;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>UniSchedule</Text>
          <Text style={styles.dateSubtitle}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => router.push('/import')}
          >
            <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => router.push({ pathname: '/edit-lecture', params: { mode: 'add' } })}
          >
            <Ionicons name="add" size={22} color={Colors.bg} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayBar}
        contentContainerStyle={styles.dayBarContent}
        ref={scrollRef}
      >
        {DAYS.map(d => {
          const isToday = d === todayShort;
          const isSelected = d === selectedDay;
          return (
            <TouchableOpacity
              key={d}
              style={[styles.dayPill, isSelected && styles.dayPillSelected]}
              onPress={() => handleDayPress(d)}
              activeOpacity={0.7}
            >
              {isToday && <View style={styles.todayDot} />}
              <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {nextLecture && (
        <View style={styles.nextLectureBanner}>
          <View style={styles.nextLectureHeader}>
            <Ionicons name="time-outline" size={14} color={Colors.primary} />
            <Text style={styles.nextLectureTitle}>Next Lecture</Text>
          </View>
          <Text style={styles.nextLectureCountdown}>
            {formatTimeLeft(nextLecture.msLeft)}
          </Text>
          <Text style={styles.nextLectureMeta}>
            {nextLecture.lecture.subject} · {DAY_SHORT[nextLecture.lecture.day] ?? nextLecture.lecture.day} · {formatTime(nextLecture.lecture.startTime)}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={56} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No classes</Text>
          <Text style={styles.emptyText}>No lectures scheduled for {DAY_FULL[selectedDay]}</Text>
          <TouchableOpacity
            style={styles.emptyAddBtn}
            onPress={() => router.push({ pathname: '/edit-lecture', params: { mode: 'add', day: DAY_FULL[selectedDay] } })}
          >
            <Ionicons name="add" size={16} color={Colors.bg} />
            <Text style={styles.emptyAddText}>Add Lecture</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <LectureCard
              lecture={item}
              isCurrent={currentLecture?.id === item.id}
              onEdit={() => router.push({ pathname: '/edit-lecture', params: { mode: 'edit', id: String(item.id) } })}
              onDelete={() => handleDelete(item.id)}
              onToggleReminder={v => handleToggleReminder(item.id, v)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
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
    paddingVertical: 16,
  },
  appTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  dateSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  importBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBar: {
    flexGrow: 0,
    marginBottom: 8,
    height: 40,
  },
  dayBarContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  dayPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayPillSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  todayDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.accent,
  },
  dayText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: Colors.textSecondary,
  },
  dayTextSelected: {
    color: Colors.bg,
  },
  glowBorder: {
    borderWidth: 1.5,
    borderRadius: 18,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardCurrent: {
    backgroundColor: '#131A0A',
    borderRadius: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 14,
  },
  timeBlock: {
    alignItems: 'center',
    minWidth: 62,
  },
  timeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  timeLine: {
    width: 1,
    flex: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
    minHeight: 16,
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  subject: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: Colors.text,
    flex: 1,
    lineHeight: 21,
  },
  subjectCurrent: {
    color: Colors.primary,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212,175,55,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  liveText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: Colors.primary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reminderLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  nextLectureBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primaryDim,
    backgroundColor: 'rgba(138, 180, 248, 0.08)',
    gap: 3,
  },
  nextLectureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  nextLectureTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nextLectureCountdown: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  nextLectureMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    color: Colors.text,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyAddText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: Colors.bg,
  },
});
