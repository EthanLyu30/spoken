/**
 * Incremental sentence extraction for streaming replies.
 *
 * As a reply streams in token-by-token we want to start speaking each sentence
 * the moment it's complete, without re-speaking earlier ones. `nextSentences`
 * takes the cumulative text so far plus how far we've already consumed, and
 * returns the newly-complete sentences and the new consumed offset.
 */

const TERMINATORS = ".!?…";
const CLOSERS = ".!?…\"')]";

export interface SentenceCut {
  /** Newly-complete sentences (trimmed, non-empty), in order. */
  sentences: string[];
  /** Absolute index in `full` up to which text has now been consumed. */
  consumed: number;
}

/**
 * Pull complete sentences out of a growing reply.
 *
 * @param full   cumulative reply text so far
 * @param from   absolute index already consumed by earlier calls
 * @param final  true on the last call — emit the trailing tail even if it has
 *               no terminal punctuation; false while still streaming — leave an
 *               unterminated tail for next time.
 */
export function nextSentences(full: string, from: number, final: boolean): SentenceCut {
  const sentences: string[] = [];
  let cur = from;
  let i = from;

  while (i < full.length) {
    const c = full[i];
    if (!TERMINATORS.includes(c)) {
      i++;
      continue;
    }
    // Swallow runs of terminators / closing quotes: `?!"`, `..."`, etc.
    let j = i + 1;
    while (j < full.length && CLOSERS.includes(full[j])) j++;

    if (j >= full.length) {
      // Punctuation at the very end — might still be mid-stream.
      if (!final) break;
      const seg = full.slice(cur, j).trim();
      if (seg) sentences.push(seg);
      cur = j;
      i = j;
      continue;
    }
    if (/\s/.test(full[j])) {
      const seg = full.slice(cur, j).trim();
      if (seg) sentences.push(seg);
      cur = j;
      i = j;
      continue;
    }
    // Non-space follows (e.g. "3.5", "U.S.") — not a sentence boundary.
    i = j;
  }

  if (final && cur < full.length) {
    const seg = full.slice(cur).trim();
    if (seg) sentences.push(seg);
    cur = full.length;
  }

  return { sentences, consumed: cur };
}
