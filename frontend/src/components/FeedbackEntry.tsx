import { ArrowUpRight, Mail, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStats } from "../lib/api";
import { getToken } from "../lib/authToken";
import { getClientId } from "../lib/clientId";
import { getFeedbackPool, type FeedbackSource } from "../lib/productFeedbackApi";
import { useAuth } from "../store/auth";

export function PipFeedbackBubble() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const refresh = () => {
      if (loading) return;
      loading = true;
      void getFeedbackPool(controller.signal).then(pool => {
        if (controller.signal.aborted) return;
        setRemaining(pool.remaining);
        setStatus(pool.status);
      }).catch(() => { if (!controller.signal.aborted) setStatus(""); }).finally(() => { loading = false; });
    };
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <Link to="/feedback?from=home" className="home-feedback-bubble">
    <Mail size={15} aria-hidden="true" />
    <span><strong>{status === "active" ? "Pip 请客" : "给 Pip 写封信"}</strong>
      <small>{status === "active" && remaining !== null
        ? remaining < 10 ? "奖池已预留 · 仍可写反馈" : `奖池剩余 ¥${remaining} · 写反馈`
        : "意见反馈"}</small></span>
    <ArrowUpRight size={16} aria-hidden="true" />
  </Link>;
}

export function PracticeFeedbackInvite({ completed, source }: {
  completed: boolean; source: Extract<FeedbackSource, "scene_report" | "interview_result">;
}) {
  const generation = useAuth(state => state.generation);
  const userId = useAuth(state => state.user?.id);
  const [shownFor, setShownFor] = useState<number | null>(null);
  useEffect(() => {
    if (!completed) return;
    const owner = userId != null ? `account-${userId}` : getToken() ? null : `guest-${getClientId()}`;
    if (!owner) return;
    const key = `spoken.feedback.invited.${owner}`;
    const controller = new AbortController();
    try {
      if (localStorage.getItem(key)) return;
    } catch { return; }
    void getStats(controller.signal).then(stats => {
      if (controller.signal.aborted || stats.total_sessions + stats.total_practice < 3) return;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, "1");
        setShownFor(generation);
      } catch { /* Without durable storage skip the automatic invitation. */ }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [completed, generation, userId]);
  if (!completed || shownFor !== generation) return null;
  return <aside className="practice-feedback-invite print:hidden" aria-label="练后意见反馈">
    <Mail size={19} aria-hidden="true" />
    <p><strong>这次练得怎么样？</strong><span>哪里帮到了你，哪里还可以更顺？</span></p>
    <Link className="ui-link" to={`/feedback?from=${source}`}>写反馈 <ArrowUpRight size={15} aria-hidden="true" /></Link>
    <button type="button" aria-label="关闭反馈提示" onClick={() => setShownFor(null)}><X size={18} aria-hidden="true" /></button>
  </aside>;
}
