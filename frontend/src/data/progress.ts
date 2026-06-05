/**
 * Sample learner progress used to drive the gamified UI in the scaffold.
 * Replaced by data served from the backend in a later PR.
 */
export interface UserProgress {
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  streakDays: number;
  todayMinutes: number;
  goalMinutes: number;
  wordsLearned: number;
}

export const userProgress: UserProgress = {
  name: "Alex",
  level: 3,
  xp: 320,
  xpToNext: 500,
  streakDays: 5,
  todayMinutes: 8,
  goalMinutes: 15,
  wordsLearned: 142,
};

/** XP reward shown on a scenario, derived from its difficulty + length. */
export function xpReward(difficulty: number, minutes: number): number {
  return difficulty * 20 + minutes * 5;
}
