import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { confirmFeedbackEmail } from "../lib/productFeedbackApi";

export default function FeedbackEmailConfirm() {
  const { ticketId = "" } = useParams();
  const { hash } = useLocation();
  const [token] = useState(() => new URLSearchParams(hash.slice(1)).get("token") ?? "");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const valid = /^[a-f0-9]{24}$/.test(ticketId) && /^[a-f0-9]{64}$/.test(token);

  useEffect(() => () => request.current?.abort(), []);

  async function confirm() {
    if (!valid || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      await confirmFeedbackEmail(ticketId, token, controller.signal);
      if (!controller.signal.aborted) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        setDone(true);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "暂时无法确认，请再试一次。");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="feedback-page feedback-receipt">
    <main id="spoken-main" tabIndex={-1} className="feedback-main">
      <section className="feedback-panel feedback-confirmation" aria-labelledby="feedback-confirm-title">
        <span className="feedback-kicker"><Mail size={16} aria-hidden="true" /> SPOKEN 意见反馈</span>
        <h1 id="feedback-confirm-title">{done ? "邮箱已确认" : "确认接收审核结果"}</h1>
        {done ? <p className="feedback-notice" role="status"><CheckCircle2 size={18} aria-hidden="true" />
          审核结论会发到这个邮箱。现在可以关闭此页。</p> : valid ? <>
          <p>确认后，Spoken 会把这条反馈的审核结果发到你的邮箱。</p>
          <button className="ui-button" type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? "正在确认…" : "确认接收"}
          </button>
        </> : <p className="feedback-error" role="alert">确认链接不完整。可以在原回执里重新发送。</p>}
        {error && <p className="feedback-error" role="alert">{error}</p>}
        <Link to="/feedback" className="ui-link">返回反馈信箱</Link>
      </section>
    </main>
    <BottomNav />
  </div>;
}
