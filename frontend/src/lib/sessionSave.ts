/**
 * Save one practice per owner and practice ID. A score can arrive after the
 * transcript and marks have already been saved.
 */
import { postSession, type ChatMessage, type Correction, type CustomScene, type FeedbackResponse, type SaveSessionPayload } from "./api";
import { getToken, getAuthGeneration } from "./authToken";
import { getClientId } from "./clientId";
import { correctionKey } from "./practiceCorrections";
import { isDeletedPractice } from "./practiceRecordStatus";

type Assessment = Pick<SaveSessionPayload, "overall" | "summary" | "tip" | "scores" | "corrections">;
type SavedAssessment = Assessment & {id?: number; createdAt?: string};
type Receipt = { scored: boolean; assessment?: SavedAssessment; deleted?: boolean };
const saved = new Map<string, Receipt>();
const pending = new Map<string, { scored: boolean; corrections?: Correction[]; request: Promise<SavedAssessment | undefined> }>();
const deletedError = () => Object.assign(new Error("这条练习记录已删除。"), { code: "practice_record_deleted" });

function remember(key: string, receipt: Receipt) {
  saved.set(key, receipt);
  if (saved.size > 200) {
    const oldest = saved.keys().next().value;
    if (oldest !== undefined) saved.delete(oldest);
  }
}

function newFavorites(incoming?: Correction[], retained?: Correction[]): Correction[] {
  const favorites = incoming?.filter(fix => fix.self_marked && fix.marked);
  if (!favorites?.length) return [];
  const existing = new Map(retained?.filter(fix => fix.self_marked && fix.marked).map(fix => [correctionKey(fix), fix]));
  return favorites.filter(fix => {
    const previous = existing.get(correctionKey(fix));
    return !previous || (!previous.suggestion.trim() && Boolean(fix.suggestion.trim()));
  });
}

export function syncSavedCorrections(sessionId: number, createdAt: string, corrections: Correction[]) {
  const owner = `${getToken() ?? getClientId()}|`;
  for (const [key, receipt] of saved) {
    if (key.startsWith(owner) && receipt.assessment?.id === sessionId && receipt.assessment.createdAt === createdAt) {
      saved.set(key, { ...receipt, assessment: { ...receipt.assessment, corrections } });
    }
  }
}

export function forgetSavedSession(sessionId: number, createdAt: string) {
  const owner = `${getToken() ?? getClientId()}|`;
  for (const [key, receipt] of saved) {
    if (key.startsWith(owner) && receipt.assessment?.id === sessionId && receipt.assessment.createdAt === createdAt) {
      saved.set(key, { scored: false, deleted: true });
    }
  }
}

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
): Promise<SavedAssessment | undefined> {
  if (generation !== getAuthGeneration()) return;
  const sig = `${getToken() ?? getClientId()}|${practiceId}`;
  // getClientId can discover an external clear before its storage event arrives.
  if (generation !== getAuthGeneration()) return;
  const scored = feedback.overall !== null;
  const retained = saved.get(sig);
  if (retained?.deleted) throw deletedError();
  if (retained && (retained.scored || !scored) && !newFavorites(feedback.corrections, retained.assessment?.corrections).length) {
    return retained.assessment;
  }
  const existing = pending.get(sig);
  if (existing) {
    if ((!scored || existing.scored) && !newFavorites(feedback.corrections, existing.corrections).length) return existing.request;
    // A follow-up carries the full conversation if the first write failed.
    await existing.request.catch(() => undefined);
    return persistSessionOnce(scenarioId, messages, feedback, practiceId, generation, custom);
  }
  const payload: SaveSessionPayload = {
    client_session_id: practiceId,
    scenario_id: scenarioId,
    messages,
    overall: feedback.overall,
    summary: feedback.summary,
    tip: feedback.tip,
    scores: feedback.scores,
    ...(feedback.corrections?.length ? { corrections: feedback.corrections } : {}),
    ...(scenarioId === "custom" && custom ? { custom } : {}),
  };
  const request = postSession(payload).then((result) => {
    if (generation !== getAuthGeneration()) return;
    const current = saved.get(sig);
    if (current?.deleted) throw deletedError();
    const assessment = result?.overall !== undefined ? {
      id: result.id, createdAt: result.created_at,
      overall: result.overall, summary: result.summary, tip: result.tip,
      scores: result.scores, corrections: result.corrections,
    } : undefined;
    const scoredResult = assessment ? assessment.overall !== null : scored;
    if (!current?.scored || scoredResult) remember(sig, {scored: scoredResult, assessment});
    return assessment;
  }, error => {
    const deleted = isDeletedPractice(error);
    if (deleted && generation === getAuthGeneration()) remember(sig, {scored: false, deleted});
    throw error;
  }).finally(() => { if (pending.get(sig)?.request === request) pending.delete(sig); });
  pending.set(sig, { scored, corrections: feedback.corrections, request });
  return request;
}
