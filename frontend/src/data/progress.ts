/**
 * Progress-related helpers. Real learner stats (level / XP / streak / goal) come
 * from the backend `GET /api/stats`; only this pure display helper lives here.
 */

/** XP reward shown on a scenario card, derived from its difficulty + length. */
export function xpReward(difficulty: number, minutes: number): number {
  return difficulty * 20 + minutes * 5;
}
