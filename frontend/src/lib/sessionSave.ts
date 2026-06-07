/**
 * Persist a finished practice session exactly once. Both the report page (after
 * showing the debrief) and the conversation page (when you leave without opening
 * the debrief) call this; an in-memory signature set dedupes so a session is
 * saved a single time.
 */
import { postSession, type ChatMessage, type FeedbackResponse } from "./api";

const saved = new Set<string>();

function signature(scenarioId: string, messages: ChatMessage[], overall: number): string {
  return `${scenarioId}|${messages.length}|${overall}`;
}

export async function persistSessionOnce(
  scenarioId: string,
  messages: ChatMessage[],
  feedback: FeedbackResponse,
): Promise<void> {
  const sig = signature(scenarioId, messages, feedback.overall);
  if (saved.has(sig)) return;
  saved.add(sig);
  try {
    await postSession({
      scenario_id: scenarioId,
      messages,
      overall: feedback.overall,
      summary: feedback.summary,
      tip: feedback.tip,
      scores: feedback.scores,
    });
  } catch {
    saved.delete(sig); // allow a later retry on failure
  }
}
