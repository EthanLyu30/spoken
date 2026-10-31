/**
 * Persist a finished practice session exactly once. Both the report page (after
 * showing the debrief) and the conversation page (when you leave without opening
 * the debrief) call this; an in-memory signature set dedupes so a session is
 * saved a single time.
 */
import { postSession, type ChatMessage, type FeedbackResponse } from "./api";
import { getToken, getAuthGeneration } from "./authToken";
import { getClientId } from "./clientId";

const saved = new Set<string>();
const pending = new Map<string, Promise<void>>();

export function createPracticeId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function persistSessionOnce(
  scenarioId: string,
  messages: ChatMessage[],
  feedback: FeedbackResponse,
  practiceId: string,
  generation: number = getAuthGeneration(),
): Promise<void> {
  if (generation !== getAuthGeneration()) return;
  const sig = `${getToken() ?? getClientId()}|${practiceId}`;
  // getClientId can discover an external clear before its storage event arrives.
  if (generation !== getAuthGeneration()) return;
  if (saved.has(sig)) return;
  const existing = pending.get(sig);
  if (existing) return existing;
  const request = postSession({
      client_session_id: practiceId,
      scenario_id: scenarioId,
      messages,
      overall: feedback.overall,
      summary: feedback.summary,
      tip: feedback.tip,
      scores: feedback.scores,
    }).then(() => {
      saved.add(sig);
      if (saved.size > 200) saved.delete(saved.values().next().value as string);
    }).finally(() => { pending.delete(sig); });
  pending.set(sig, request);
  return request;
}
