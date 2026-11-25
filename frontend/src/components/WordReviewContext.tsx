import { Bookmark, MapPin, Quote } from "lucide-react";
import { getScenario } from "../data/scenarios";
import type { Word } from "../lib/api";

const normalized = (value: string) => (value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

export function WordReviewContext({ word, hiddenAnswers = [], showConversation = false }: {
  word: Word;
  hiddenAnswers?: string[];
  showConversation?: boolean;
}) {
  const scene = getScenario(word.scenario_id);
  const custom = word.scenario_id === "custom" && word.source?.key.startsWith("custom-");
  const daily = word.source?.key === "daily";
  const containsAnswer = (text: string) => hiddenAnswers.some(answer => {
    const phrase = normalized(answer);
    return phrase && ` ${normalized(text)} `.includes(` ${phrase} `);
  });
  const location = scene?.titleZh ?? (custom ? word.source?.title?.trim() : undefined);
  const topic = word.topic?.trim();
  const fromScene = !!location;
  const title = location ? (containsAnswer(location) ? "场景练习" : location)
    : daily ? "每日金句" : topic && topic !== "未分类" && !containsAnswer(topic) ? topic : null;
  if (!title) return null;

  const Icon = fromScene ? MapPin : daily ? Quote : Bookmark;
  const subtitle = scene?.subtitle;
  const previous = fromScene && showConversation ? word.source?.previous_partner_message?.trim() : undefined;
  return <div className="wordbag-origin" role="group" aria-label="收藏来源">
    <div className="wordbag-origin-row">
      <Icon size={15} aria-hidden="true" />
      <span>{fromScene ? "场景" : daily ? "来源" : "话题"}</span>
      <strong>{title}</strong>
      {subtitle && !containsAnswer(subtitle) && <span className="wordbag-origin-background">{subtitle}</span>}
    </div>
    {previous && <details className="wordbag-origin-conversation">
      <summary>查看当时 Pip 的上一句</summary>
      <p lang="en">{previous}</p>
    </details>}
  </div>;
}
