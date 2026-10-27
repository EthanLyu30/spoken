import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { SceneTabs } from "../components/SceneTabs";
import { createCustomScene } from "../lib/api";
import { useCustomScene } from "../store/custom";

const EXAMPLES = [
  "在银行开一个新账户",
  "和房东商量房租和水电",
  "退掉一件买错尺码的衣服",
  "面试一家创业公司的产品经理",
  "在国外的药店买感冒药",
  "跟同事约一起吃午饭",
];

export default function CustomScenePage() {
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const setScene = useCustomScene((s) => s.setScene);
  const navigate = useNavigate();

  async function go(text: string) {
    const description = text.trim();
    if (!description || loading) return;
    setLoading(true);
    setError(false);
    try {
      const scene = await createCustomScene(description);
      setScene(scene);
      navigate("/practice/custom");
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <main className="mx-auto w-full max-w-2xl px-5 py-6 custom-page">
        <div className="ui-page-head">
          <div>
            <p className="eyebrow">CUSTOM SCENE</p>
            <h1>想练什么，自己说了算</h1>
            <p>描述一个场景，Pip 立刻变身对应角色，陪你即兴对话。</p>
          </div>
          <SceneTabs />
        </div>
        <div className="custom-layout">
          <div>
            <section className="card p-5 md:p-6">
              <textarea
                aria-label="想练习的场景"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(desc);
                }}
                rows={3}
                placeholder="例如：在咖啡店面试一份兼职；或者用英文写也行～"
                className="w-full resize-none rounded-2xl border border-border bg-surface-2 px-4 py-3 text-ink outline-none placeholder:text-muted focus:border-coral"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted">⌘/Ctrl + Enter 开始</span>
                <button
                  type="button"
                  onClick={() => go(desc)}
                  disabled={loading || !desc.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {loading ? "正在搭场景…" : "生成并开始"}
                </button>
              </div>
              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-2xl bg-[#ffe8e3] px-4 py-2.5 text-sm font-semibold text-[#e6503d]"
                >
                  生成失败，请确认后端在运行后重试。
                </p>
              )}
            </section>

            <h2 className="mb-3 mt-7 font-display text-lg font-semibold text-ink">
              没想法？试试这些
            </h2>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setDesc(ex);
                    go(ex);
                  }}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5 text-coral-deep" /> {ex}
                </button>
              ))}
            </div>
          </div>
          <aside className="custom-aside">
            <Buddy mood={loading ? "talking" : "happy"} size={100} />
            <h2>一句话，就能搭好场景。</h2>
            <p>告诉 Pip 你在哪里、想扮演什么角色、希望练习什么。</p>
            <div>
              <h3>比如，可以这样描述</h3>
              <p>
                “我在伦敦的一家咖啡馆，想点一杯燕麦拿铁，并问问有没有无麸质点心。”
              </p>
            </div>
            <p>中英文都可以，不需要准备完整剧本。</p>
          </aside>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
