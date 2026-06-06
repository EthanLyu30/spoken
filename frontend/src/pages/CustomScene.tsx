import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, Wand2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
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

      <header className="mx-auto w-full max-w-2xl px-5 pt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
        >
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Buddy mood={loading ? "talking" : "happy"} size={92} />
          <div>
            <p className="eyebrow">Custom scene · 自定义场景</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">
              想练什么，自己说了算
            </h1>
            <p className="mt-1 text-sm text-muted">
              描述一个场景，Pip 立刻变身对应角色，陪你即兴对话。
            </p>
          </div>
        </div>

        <section className="card p-5 md:p-6">
          <textarea
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
            <p className="mt-3 rounded-2xl bg-[#ffe8e3] px-4 py-2.5 text-sm font-semibold text-[#e6503d]">
              生成失败，请确认后端在运行后重试。
            </p>
          )}
        </section>

        <h2 className="mb-3 mt-7 font-display text-lg font-semibold text-ink">没想法？试试这些</h2>
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
      </main>

      <BottomNav />
    </div>
  );
}
