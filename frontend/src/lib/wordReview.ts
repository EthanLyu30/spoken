import type { Word } from "./api";

export type ReviewMode = "flip" | "translate" | "cloze";

const functionWords = new Set("am are as be been being can could did does from had has have how into its may might must one our shall she should than that the their them then there these they this those too was were what when where which who why will with would you your".split(" "));

export function reviewPrompt(word: Word, mode: ReviewMode): { prompt: string; answer: string } | null {
  if (mode === "translate") return word.meaning.trim() ? { prompt: word.meaning, answer: word.text } : null;
  if (mode !== "cloze") return null;
  const source = word.example.trim();
  const expression = word.text.trim().replace(/[.!?]+$/, "");
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (word.kind !== "sentence" && source && expression) {
    const matches = [...source.matchAll(new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, "giu"))];
    if (matches.length === 1) {
      const [match, boundary, answer] = matches[0];
      const start = matches[0].index + boundary.length;
      const before = source.slice(0, start);
      const after = source.slice(matches[0].index + match.length);
      if (/[a-z]/i.test(before + after)) return { prompt: before + "____" + after, answer };
    }
  }
  const tokens = [...word.text.matchAll(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g)];
  if (tokens.length < 2) return null;
  const counts = new Map<string, number>();
  for (const [token] of tokens) {
    const key = token.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Keep the context readable and avoid giving the answer away elsewhere in the sentence.
  const target = tokens.reverse().find(([token]) => {
    const key = token.toLowerCase();
    return key.length >= 3 && !functionWords.has(key) && counts.get(key) === 1;
  });
  if (!target) return null;
  const [answer] = target;
  return { prompt: word.text.slice(0, target.index) + "____" + word.text.slice(target.index + answer.length), answer };
}

export function matchesReviewAnswer(input: string, reference: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase()
    .replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  const answer = normalize(input);
  const expected = normalize(reference);
  const endsInQuestion = /\?[.!?]*$/;
  if (endsInQuestion.test(answer) !== endsInQuestion.test(expected)) return false;
  return answer.replace(/[.!?]+$/, "") === expected.replace(/[.!?]+$/, "");
}

export function reviewDueAt(value?: string | null): Date | null {
  if (!value) return null;
  const utc = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z`
    : /(?:z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const due = new Date(utc);
  return Number.isNaN(due.getTime()) ? null : due;
}

export function familiarityOf(word: Word) {
  if (word.mastered) return "familiar";
  return word.familiarity ?? (word.last_reviewed ? (word.box ? "familiar" : "forgot") : "new");
}
