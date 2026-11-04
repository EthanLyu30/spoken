import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Mic, Quote, Route, Volume2 } from "lucide-react";
import { DailyScenePick } from "../components/DailyScenePick";
import { DailyGoal } from "../components/DailyGoal";
import { BottomNav } from "../components/BottomNav";
import { BackendStatus } from "../components/BackendStatus";
import { quotes } from "../data/quotes";
import { speakText } from "../lib/speech";

export default function Home() {
  const quote = quotes[Math.floor(Date.now() / 86400000) % quotes.length];
  useEffect(() => {
    // Warm the practice route after the landing data has settled. The CTA
    // also starts the import on hover/focus/touch so the first tap is cheap.
    const preload = () => { void import("./Conversation"); };
    const idleHost = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleHost.requestIdleCallback) {
      const handle = idleHost.requestIdleCallback(preload, { timeout: 5_000 });
      return () => idleHost.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preload, 2_500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="min-h-screen pb-24 home-page">
      <section className="home-hero">
        <div className="hero-inner">
          <p className="hero-kicker">PIP 和你一起，每天练习真实的英语对话</p>
          <h1>今天，开口就好。</h1>
          <p className="hero-subtitle">每天一点真实对话，让英语自然一点。</p>
          <div className="hero-actions">
            <Link
              to="/practice/cafe"
              className="ui-button"
              onPointerEnter={() => { void import("./Conversation"); }}
              onFocus={() => { void import("./Conversation"); }}
              onPointerDown={() => { void import("./Conversation"); }}
            >
              <Mic />
              开始语音练习
            </Link>
            <div>
              <Link to="/scenes" className="ui-secondary">
                <Route />
                进入场景练习
              </Link>
              <small>闯关地图 · 自定义场景</small>
            </div>
          </div>
        </div>
      </section>
      <main className="mx-auto home-content">
        <div className="home-recommend">
          <DailyScenePick />
          <DailyGoal />
        </div>
        <section className="home-quote">
          <h2>
            <Quote />
            每日金句
          </h2>
          <div>
            <p>{quote.text}</p>
            <small>
              {quote.zh} · {quote.author}
              {quote.source && `《${quote.source}》`}
            </small>
          </div>
          <button
            type="button"
            className="ui-secondary"
            onClick={() => speakText(quote.text)}
          >
            <Volume2 />
            听一听
          </button>
          <Link to="/daily" className="ui-link">
            更多金句
            <ArrowRight />
          </Link>
        </section>
      </main>
      <footer className="home-footer">
        <span>Spoken · 和 Pip 一起练英语口语</span>
        <BackendStatus />
      </footer>
      <BottomNav />
    </div>
  );
}
