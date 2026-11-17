import type { Correction, CorrectionCategory, FeedbackResponse } from "./api";

export const correctionDrills = {
  articles: { label: "冠词", task: "第一次提到一个可数的人或物时，用 a 或 an。对方已知道你指哪一个时，用 the。", prompt: "第一次提到一把雨伞，接着再提同一把雨伞。用英语说两句。", answer: "I need an umbrella. Is the umbrella by the door?" },
  tense: { label: "动词时态", task: "先说清事情发生的时间，再选动词形式。用过去式说已经结束的事。", prompt: "用一句话说明你昨天做了什么，再说你今天的计划。", answer: "I booked a room yesterday. I'll check in today." },
  agreement: { label: "主谓一致", task: "先找主语。说一般现在时，主语是 he、she 或单数名词时，通常给动词加 -s。", prompt: "分别用 I 和 my friend 作主语，说你们各需要什么。", answer: "I need a receipt. My friend needs one too." },
  word_order: { label: "语序", task: "问问题时，先练直接问句。用 Could you tell me 开头时，后面用陈述句语序。", prompt: "先直接问登机口在哪里，再用 Could you tell me 礼貌地问一遍。", answer: "Where is the gate? Could you tell me where the gate is?" },
  sentence_structure: { label: "句子结构", task: "先说出主语和动词，再加原因、条件或细节。用 because 接一个完整原因。", prompt: "用一个完整句子提出请求，再解释原因。", answer: "I'd like to change my seat because I need to sit with my child." },
  prepositions: { label: "介词", task: "具体时间常用 at，日期常用 on，较长的时段常用 in。把介词和后面的词一起记。", prompt: "说出一个预约的具体日期和时间。", answer: "My appointment is on Monday at ten." },
  word_choice: { label: "用词搭配", task: "把动作和常搭配的名词一起记。先把句子说完整，再替换具体内容。", prompt: "用 make a reservation 说你想预订什么。", answer: "I'd like to make a reservation for two, please." },
} satisfies Record<CorrectionCategory, { label: string; task: string; prompt: string; answer: string }>;

export function isCorrectionCategory(value: string | null): value is CorrectionCategory {
  return value !== null && Object.prototype.hasOwnProperty.call(correctionDrills, value);
}

export function correctionKey(entry: Correction): string {
  return JSON.stringify([entry.turn_index ?? null, entry.category ?? null, entry.original.trim().toLowerCase()]);
}

export function includeMarkedCorrections(feedback: FeedbackResponse, marked: Correction[]): FeedbackResponse {
  if (!marked.length) return feedback;
  const marks = new Set(marked.map(correctionKey));
  return { ...feedback, corrections: [...marked, ...(feedback.corrections ?? []).filter((entry) => !marks.has(correctionKey(entry)))] };
}
