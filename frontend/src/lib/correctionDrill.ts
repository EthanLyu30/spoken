import type { Correction } from "./api";
import type { ReplaySentence } from "./practiceCorrections";
import { nextSentences } from "./sentences";

type Token = { key: string; start: number; end: number };
type Edit = { start: number; end: number; old: string; replacement: string; newStart: number };
type Blank = { edit: Edit; before: string; answer: string; offset: number };

const article = /^(?:a|an|the)$/;
const preposition = /^(?:at|on|in|from|to|for|by|of|about|with|into|over|under|after|before)$/;
const word = /[\p{L}\p{N}]/u;

export interface TranslationExercise {
  original: string;
  reference: string;
  previous_partner_message: string;
  focus: Pick<Correction, "original" | "suggestion" | "category">;
}

function tokens(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^\s]/gu), match => ({
    key: match[0].toLowerCase().replace(/’/g, "'"), start: match.index!, end: match.index! + match[0].length,
  }));
}

function locations(line: Token[], fragment: string): number[] {
  const words = tokens(fragment);
  if (!words.length) return [];
  return line.flatMap((_, start) => words.every((word, i) => line[start + i]?.key === word.key) ? [start] : []);
}

export function containsCorrection(line: string, fix: Correction): boolean {
  return locations(tokens(line), fix.original).length > 0;
}

// The common tokens delimit actual edits. A correction that rewrites two
// distant words can therefore keep the intervening words visible in a cloze.
function changes(source: string, from: Token[], suggestion: string): Edit[] {
  const to = tokens(suggestion);
  const width = to.length + 1;
  const common = new Uint16Array((from.length + 1) * width);
  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      const index = i * width + j;
      common[index] = from[i].key === to[j].key ? 1 + common[index + width + 1]
        : Math.max(common[index + width], common[index + 1]);
    }
  }
  const edits: Edit[] = [];
  let oldCursor = 0, newCursor = 0;
  function addGap(i: number, j: number) {
    if (oldCursor === i && newCursor === j) return;
    let start = oldCursor ? from[oldCursor - 1].end : from[0].start;
    let end = from[i]?.start ?? from[from.length - 1].end;
    let newStart = newCursor ? to[newCursor - 1].end : 0;
    let replacement = suggestion.slice(newStart, to[j]?.start ?? suggestion.length);
    // Trim only shared whitespace so adjacent independent edits can coexist.
    if (start < end && /^\s/.test(replacement) && source[start] === replacement[0]) {
      start++; newStart++; replacement = replacement.slice(1);
    }
    if (start < end && /\s$/.test(replacement) && source[end - 1] === replacement[replacement.length - 1]) {
      end--; replacement = replacement.slice(0, -1);
    }
    if (!suggestion && source[end] === " " && (start === 0 || source[start - 1] === " ")) end++;
    else if (!suggestion && start > 0 && source[start - 1] === " " && !/^[\p{L}\p{N}]/u.test(source.slice(end))) start--;
    edits.push({ start, end, old: source.slice(start, end), replacement, newStart });
  }
  let i = 0, j = 0;
  while (i < from.length && j < to.length) {
    if (from[i].key === to[j].key) {
      addGap(i, j);
      oldCursor = ++i; newCursor = ++j;
    } else if (common[(i + 1) * width + j] >= common[i * width + j + 1]) i++;
    else j++;
  }
  addGap(from.length, to.length);
  // A recorded capitalization change can preserve all word keys.
  if (!edits.length && source.slice(from[0].start, from[from.length - 1].end).trim().toLowerCase() === suggestion.toLowerCase()
      && source.slice(from[0].start, from[from.length - 1].end) !== suggestion) {
    edits.push({ start: from[0].start, end: from[from.length - 1].end,
      old: source.slice(from[0].start, from[from.length - 1].end), replacement: suggestion, newStart: 0 });
  }
  return edits;
}

function editsAt(line: string, words: Token[], index: number, fix: Correction) {
  const suggestion = fix.suggestion.trim();
  const edits = changes(line, words.slice(index, index + tokens(fix.original).length), suggestion);
  if (fix.category === "word_order") {
    // A move looks like a deletion plus an insertion to the word diff. Ask for
    // the reordered phrase so the learner has to place both pieces correctly.
    for (const removal of edits.filter(edit => !edit.replacement.trim())) {
      const added = edits.find(edit => !edit.old.trim()
        && edit.replacement.trim().toLowerCase() === removal.old.trim().toLowerCase());
      if (!added) continue;
      const start = Math.min(removal.start, added.start), end = Math.max(removal.end, added.end);
      const newStart = Math.min(removal.newStart, added.newStart);
      const newEnd = Math.max(removal.newStart + removal.replacement.length, added.newStart + added.replacement.length);
      return [...edits.filter(edit => edit.end < start || edit.start > end),
        { start, end, old: line.slice(start, end), newStart, replacement: suggestion.slice(newStart, newEnd) }];
    }
  }
  return edits;
}

function phrase(edit: Edit, before: Token[], after: Token[], offset = 0): Blank {
  return {
    edit,
    before: before.length ? edit.old.slice(before[0].start, before[before.length - 1].end) : "",
    answer: after.length ? edit.replacement.slice(after[0].start, after[after.length - 1].end) : "",
    offset: after[0]?.start ?? offset,
  };
}

function verbPhrase(words: Token[]) {
  const eligible = (token: Token) => word.test(token.key) && !article.test(token.key) && !preposition.test(token.key);
  const first = words.findIndex(eligible);
  if (first < 0) return [];
  const stop = words.findIndex((token, index) => index > first && !eligible(token));
  return words.slice(first, stop < 0 ? words.length : stop);
}

function blankFor(edits: Edit[], category: Correction["category"]): Blank | undefined {
  const kind = category === "articles" ? article : category === "prepositions" ? preposition : null;
  // A gap in the word diff can hold adjacent changes, such as buy → bought
  // plus the insertion of a. Keep composing the full edit but mask its focus.
  for (const edit of edits) {
    const before = tokens(edit.old), after = tokens(edit.replacement);
    if (kind) {
      const oldIndex = before.findIndex(token => kind.test(token.key));
      const added = after.find(token => kind.test(token.key));
      if (oldIndex >= 0 || added) {
        return phrase(edit, oldIndex < 0 ? [] : [before[oldIndex]], added ? [added] : [],
          after[oldIndex]?.start ?? edit.replacement.trimEnd().length);
      }
    } else if (category === "tense" || category === "agreement") {
      const verb = verbPhrase(after);
      if (verb.length) return phrase(edit, verbPhrase(before), verb);
    }
  }
  const edit = edits.find(edit => word.test(edit.replacement)) ?? edits[0];
  return edit && phrase(edit, tokens(edit.old), tokens(edit.replacement));
}

// Locate this blank inside a longer, already-corrected quotation. For
// example, "buy watch" → "bought a watch" can enclose both buy→bought
// and watch→a watch. Applying these independently would double the article.
function maskIn(quotation: string, suggestion: string, offset: number, length: number) {
  const outer = tokens(quotation), inner = tokens(suggestion);
  const matches = locations(outer, suggestion);
  if (matches.length !== 1) return null;
  const at = matches[0];
  const first = inner.findIndex(token => token.end > offset);
  if (first < 0) return { start: outer[at + inner.length - 1].end, length: 0 };
  const start = outer[at + first].start;
  if (!length) return { start, length: 0 };
  const last = inner.findIndex(token => token.end >= offset + length);
  if (last < first) return null;
  return { start, length: outer[at + last].end - start };
}

function translationFocus(reference: string, start: number, before: string, answer: string, fix: Correction): TranslationExercise["focus"] {
  const words = tokens(reference);
  const end = start + answer.length;
  const first = words.findIndex(token => token.start >= start);
  let left = first < 0 ? words.length : first;
  let right = left + tokens(answer).length;

  function span() {
    return {
      start: Math.min(start, words[left]?.start ?? start),
      end: Math.max(end, words[right - 1]?.end ?? end),
    };
  }

  // Insertions and deletions need an unchanged word so both forms can be
  // located in their sentence. A repeated target can use nearby context.
  for (let context = 0; context < 4; context++) {
    const range = span();
    const suggestion = reference.slice(range.start, range.end).trim();
    if (suggestion && (before || range.start < start || range.end > end)
        && locations(words, suggestion).length === 1) break;
    if (right < words.length && word.test(words[right].key)) right++;
    else if (left > 0 && word.test(words[left - 1].key)) left--;
    else break;
  }

  const range = span();
  const original = [reference.slice(range.start, start).trim(), before, reference.slice(end, range.end).trim()]
    .filter(Boolean).join(" ");
  return {
    original: original || fix.original.trim(),
    suggestion: reference.slice(range.start, range.end).trim(),
    category: fix.category ?? null,
  };
}

export function buildCorrectionDrill(example: ReplaySentence, fix: Correction) {
  if (fix.self_marked || !fix.original.trim()) return null;
  let line = example.original;
  let words = tokens(line);
  const turnWords = words;
  let occurrences = locations(words, fix.original);
  const count = occurrences.length;
  if (count > 1) {
    const candidates = nextSentences(line, 0, true).sentences.filter(sentence => locations(tokens(sentence), fix.original).length);
    // An identical set of complete sentences gives the same exercise no
    // matter which occurrence was selected, without marking every occurrence.
    if (candidates.length === count && candidates.every(sentence => sentence === candidates[0])) {
      line = candidates[0];
      words = tokens(line);
      occurrences = locations(words, fix.original);
    }
  }
  const fragment = occurrences.length !== 1;
  if (fragment) {
    // Older feedback stores quoted text without offsets. Do not guess which
    // of two identical occurrences the coach meant.
    line = fix.original.trim(); words = tokens(line); occurrences = [0];
  }
  if (!words.length) return null;
  const origin = occurrences[0];
  let edits = editsAt(line, words, origin, fix);
  const blank = blankFor(edits, fix.category);
  if (!blank) return null;
  let { edit: target, answer, offset } = blank;
  const caseSensitive = blank.before.toLowerCase() === answer.toLowerCase();
  if (!fragment) {
    const others = example.corrections.flatMap(other => {
      if (other.self_marked || (other.original === fix.original && other.suggestion === fix.suggestion)) return [];
      const places = locations(words, other.original);
      if (places.length !== 1) return [];
      // A companion correction may also occur in a different sentence.
      // Use it here only if its matches are confined to the identical copies.
      if (turnWords !== words && locations(turnWords, other.original).length !== count) return [];
      return [{ other, at: places[0], size: tokens(other.original).length }];
    });
    const focusSize = tokens(fix.original).length;
    const covers = others.filter(({ at, size }) => at <= origin && at + size >= origin + focusSize);
    let usedCover: Correction | undefined;
    for (const { other, at, size } of covers.sort((a, b) => b.size - a.size)) {
      const quotation = other.suggestion.trim();
      const mask = maskIn(quotation, fix.suggestion.trim(), target.newStart + offset, answer.length);
      if (!mask) continue;
      const start = words[at].start, end = words[at + size - 1].end;
      target = { start, end, old: line.slice(start, end), newStart: 0, replacement: quotation };
      edits = [target];
      usedCover = other;
      offset = mask.start;
      answer = quotation.slice(offset, offset + mask.length);
      break;
    }
    for (const { other, at } of others) {
      if (other === usedCover) continue;
      for (const edit of editsAt(line, words, at, other)) {
        const conflict = edits.some(prior => edit.start === prior.start || (edit.start < prior.end && prior.start < edit.end));
        if (!conflict) edits.push(edit);
      }
    }
  }
  let reference = "", cursor = 0, blankStart = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    reference += line.slice(cursor, edit.start);
    if (edit === target) blankStart = reference.length + offset;
    reference += edit.replacement;
    cursor = edit.end;
  }
  reference += line.slice(cursor);
  const head = reference.slice(0, blankStart);
  const tail = reference.slice(blankStart + answer.length);
  const prompt = head + (/[\p{L}\p{N}]$/u.test(head) ? " " : "") + "____" + (/^[\p{L}\p{N}]/u.test(tail) ? " " : "") + tail;
  const exercise: TranslationExercise = {
    original: line, reference, previous_partner_message: example.previous_partner_message,
    focus: translationFocus(reference, blankStart, blank.before, answer, fix),
  };
  return { prompt, answer, exercise, fragment, caseSensitive };
}

export function matchesBlank(attempt: string, expected: string, caseSensitive = false): boolean {
  if (!expected) return !attempt.trim();
  const normalize = (value: string) => {
    const cleaned = value.trim().replace(/’/g, "'").replace(/\s+/g, " ");
    const withoutStop = /[\p{L}\p{N}]/u.test(expected) ? cleaned.replace(/[.!?]+$/, "") : cleaned;
    return caseSensitive ? withoutStop : withoutStop.toLowerCase();
  };
  return normalize(attempt) === normalize(expected);
}
