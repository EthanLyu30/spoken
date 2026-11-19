/**
 * Save one practice per owner and practice ID. A score can arrive after the
 * transcript and marks have already been saved.
 */
import { postSession, type ChatMessage, type Correction, type CustomScene, type FeedbackResponse, type SaveSessionPayload } from "./api";
import { getToken, getAuthGeneration } from "./authToken";
import { getClientId } from "./clientId";

type Assessment = Pick<SaveSessionPayload, "overall" | "summary" | "tip" | "scores" | "corrections">;
const saved = new Map<string, { scored: boolean; assessment?: Assessment }>();
const pending = new Map<string, { scored: boolean; request: Promise<Assessment | undefined> }>();

export function unscoredSession(corrections: Correction[]): Assessment {
  return { overall: null, summary: "", tip: "", scores: [], corrections };
}

export function createPracticeId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function persistSessionOnce(
  scenarioId: string,
  messages: ChatMessage[],
  feedback: Assessment | FeedbackResponse,
  practiceId: string,
  generation: number = getAuthGeneration(),
  custom?: CustomScene | null,
): Promise<Assessment | undefined> {
  if (generation !== getAuthGeneration()) return;
  const sig = `${getToken() ?? getClientId()}|${practiceId}`;
  // getClientId can discover an external clear before its storage event arrives.
  if (generation !== getAuthGeneration()) return;
  const scored = feedback.overall !== null;
  const retained = saved.get(sig);
  if (retained && (retained.scored || !scored)) return retained.assessment;
  const existing = pending.get(sig);
  if (existing) {
    if (!scored || existing.scored) return existing.request;
    // A score still carries the full conversation if the first write failed.
    await existing.request.catch(() => undefined);
    return persistSessionOnce(scenarioId, messages, feedback, practiceId, generation, custom);
  }
  const request = postSession({
      client_session_id: practiceId,
      scenario_id: scenarioId,
      messages,
      overall: feedback.overall,
      summary: feedback.summary,
      tip: feedback.tip,
      scores: feedback.scores,
      ...(feedback.corrections?.length ? { corrections: feedback.corrections } : {}),
      ...(scenarioId === "custom" && custom ? { custom } : {}),
    }).then((result) => {
      const assessment = result?.overall !== undefined ? {
        overall: result.overall, summary: result.summary, tip: result.tip,
        scores: result.scores, corrections: result.corrections,
      } : undefined;
      saved.set(sig, {scored: assessment ? assessment.overall !== null : scored, assessment});
      if (saved.size > 200) {
        const oldest = saved.keys().next().value;
        if (oldest !== undefined) saved.delete(oldest);
      }
      return assessment;
    }).finally(() => { pending.delete(sig); });
  pending.set(sig, { scored, request });
  return request;
}
