import { describe, expect, it } from "vitest";
import type { Correction, CorrectionCategory } from "./api";
import { buildCorrectionDrill } from "./correctionDrill";

const saved = (original: string, suggestion: string, category: CorrectionCategory): Correction =>
  ({ original, suggestion, category, note: "", turn_index: 0 });

describe("grounded correction drills", () => {
  it.each([
    ["articles", "I bought ____ watch.", "a", "watch", "a watch"],
    ["tense", "I ____ a watch.", "bought", "buy", "bought"],
  ] as const)("isolates the %s target when one saved correction rewrites the whole sentence", (category, prompt, answer, original, suggestion) => {
    const fix = saved("I buy watch.", "I bought a watch.", category);
    const drill = buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill).toMatchObject({
      prompt, answer, exercise: { original: "I buy watch.", reference: "I bought a watch.", focus: { original, suggestion, category } },
    });
  });

  it("isolates adjacent selections when two categories save the same whole-sentence rewrite", () => {
    const tense = saved("I buy a umbrella.", "I bought an umbrella.", "tense");
    const articles = saved(tense.original, tense.suggestion, "articles");
    const example = { original: tense.original, previous_partner_message: "", corrections: [tense, articles] };
    expect(buildCorrectionDrill(example, tense)).toMatchObject({
      prompt: "I ____ an umbrella.", answer: "bought", exercise: { focus: { original: "buy", suggestion: "bought" } },
    });
    expect(buildCorrectionDrill(example, articles)).toMatchObject({
      prompt: "I bought ____ umbrella.", answer: "an", exercise: { focus: { original: "a", suggestion: "an" } },
    });
  });

  it("isolates the preposition next to the added article", () => {
    const fix = saved("I slept in bed.", "I slept on the bed.", "prepositions");
    const drill = buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill).toMatchObject({
      prompt: "I slept ____ the bed.", answer: "on", exercise: { focus: { original: "in", suggestion: "on" } },
    });
  });

  it("keeps both words of the selected tense beside a new article", () => {
    const fix = saved("She see doctor twice.", "She has seen a doctor twice.", "tense");
    const drill = buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill).toMatchObject({
      prompt: "She ____ a doctor twice.", answer: "has seen", exercise: { focus: { original: "see", suggestion: "has seen" } },
    });
  });

  it("keeps the whole sentence when all possible locations give the same contextual exercise", () => {
    const fix = saved("need map", "need a map", "articles");
    const drill = buildCorrectionDrill({
      original: "I need map. I need map.", previous_partner_message: "What do you need?", corrections: [fix],
    }, fix);
    expect(drill).toMatchObject({
      prompt: "I need ____ map.", answer: "a", fragment: false,
      exercise: {
        original: "I need map.", reference: "I need a map.", previous_partner_message: "What do you need?",
        focus: { original: "map", suggestion: "a map", category: "articles" },
      },
    });
  });

  it("limits the cloze to the saved wording when repeated matches have different subjects", () => {
    const fix = saved("need map", "need a map", "articles");
    const drill = buildCorrectionDrill({
      original: "I need map. They need map.", previous_partner_message: "", corrections: [fix],
    }, fix);
    expect(drill).toMatchObject({ fragment: true, prompt: "need ____ map", answer: "a" });
  });

  it("keeps an unrelated ambiguous correction out of the repeated sentence's reference", () => {
    const fix = saved("map", "a map", "articles");
    const other = saved("quickly", "slowly", "word_choice");
    const drill = buildCorrectionDrill({
      original: "I need map quickly. I need map quickly. They walk quickly.",
      previous_partner_message: "", corrections: [fix, other],
    }, fix);
    expect(drill?.exercise.reference).toBe("I need a map quickly.");
  });

  it("retains enough of the adjacent context to locate a corrected verb that also appears elsewhere", () => {
    const fix = saved("leave", "left", "tense");
    const drill = buildCorrectionDrill({
      original: "I leave home and she left work.", previous_partner_message: "", corrections: [fix],
    }, fix);
    expect(drill?.exercise.focus).toEqual({ original: "leave home", suggestion: "left home", category: "tense" });
  });

  it("keeps the translation focus and the blank on the same noun when two articles change", () => {
    const full = saved("I saw a dog and a cat.", "I saw the dog and the cat.", "articles");
    const dog = saved("a dog", "the dog", "articles");
    const cat = saved("a cat", "the cat", "articles");
    const example = {
      original: full.original, previous_partner_message: "Did you see the dog and the cat?",
      corrections: [full, dog, cat],
    };
    expect(buildCorrectionDrill(example, dog)).toMatchObject({
      prompt: "I saw ____ dog and the cat.", answer: "the",
      exercise: { reference: full.suggestion, focus: { original: "a dog", suggestion: "the dog" } },
    });
    expect(buildCorrectionDrill(example, cat)).toMatchObject({
      prompt: "I saw the dog and ____ cat.", answer: "the",
      exercise: { reference: full.suggestion, focus: { original: "a cat", suggestion: "the cat" } },
    });
  });

  it("omits a drill for a saved no-op", () => {
    const fix = saved("I bought a watch.", "I bought a watch.", "tense");
    expect(buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix)).toBeNull();
  });

  it.each([
    ["I buy watch.", "I bought a watch.", "watch", "a watch", "articles", "I bought ____ watch.", "a"],
    ["I buy watch.", "I bought a watch.", "buy", "bought", "tense", "I ____ a watch.", "bought"],
    ["I like the cats and I need a umbrella.", "I like cats and I need an umbrella.", "the cats", "cats", "articles", "I like ____ cats and I need an umbrella.", ""],
    ["I like the cats and I need a umbrella.", "I like cats and I need an umbrella.", "a umbrella", "an umbrella", "articles", "I like cats and I need ____ umbrella.", "an"],
    ["I handed over signed contract yesterday.", "I handed over the signed contract yesterday.", "signed contract", "the signed contract", "articles", "I handed over ____ signed contract yesterday.", "the"],
  ] as const)("keeps the enclosing correction while blanking %s / %s / %s", (line, reference, old, corrected, category, prompt, answer) => {
    const fix = saved(old, corrected, category);
    const full = saved(line, reference, category);
    const drill = buildCorrectionDrill({ original: line, previous_partner_message: "", corrections: [fix, full] }, fix);
    expect(drill?.exercise.reference).toBe(reference);
    expect(drill?.prompt).toBe(prompt);
    expect(drill?.answer).toBe(answer);
  });

  it("targets the verb when a sentence-wide tense correction also fixes an earlier preposition", () => {
    const fix = saved("In Monday I buy new boots.", "On Monday I bought new boots.", "tense");
    const drill = buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill?.prompt).toBe("On Monday I ____ new boots.");
  });

  it("practises word order by asking for the reordered words together", () => {
    const fix = saved("drink usually", "usually drink", "word_order");
    const drill = buildCorrectionDrill({ original: "I drink usually tea.", previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill?.prompt).toBe("I ____ tea.");
    expect(drill?.answer).toBe("usually drink");
  });

  it("holds back the reordered phrase even when the relocated adverb also changes spelling", () => {
    const fix = saved("if you shiftly pay it", "if you pay it sooner", "word_order");
    const drill = buildCorrectionDrill({ original: "We can ship it if you shiftly pay it.",
      previous_partner_message: "What would let us ship this week?", corrections: [fix] }, fix);
    expect(drill?.prompt).toBe("We can ship it if you ____.");
    expect(drill?.answer).toBe("pay it sooner");
    expect(drill?.exercise.focus).toEqual({ original: "shiftly pay it", suggestion: "pay it sooner", category: "word_order" });
  });

  it("targets the moved words when an earlier agreement error is corrected in the same quote", () => {
    const fix = saved("They was ready and never had seen this before.", "They were ready and had never seen this before.", "word_order");
    const drill = buildCorrectionDrill({ original: fix.original, previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill).toMatchObject({ prompt: "They were ready and ____ seen this before.", answer: "had never",
      exercise: { focus: { original: "never had", suggestion: "had never", category: "word_order" } } });
  });

  it("identifies a stand-alone deletion without changing punctuation or neighborhood words", () => {
    const fix = saved("the", "", "articles");
    const drill = buildCorrectionDrill({ original: "Today, the rice is cheap.", previous_partner_message: "", corrections: [fix] }, fix);
    expect(drill?.exercise.reference).toBe("Today, rice is cheap.");
    expect(drill?.prompt).toBe("Today, ____ rice is cheap.");
  });
});
