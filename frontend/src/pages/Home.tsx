import { Masthead } from "../components/Masthead";
import { ScenarioCard } from "../components/ScenarioCard";
import { BackendStatus } from "../components/BackendStatus";
import { scenarios } from "../data/scenarios";

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "夜深了，练一会儿就早点休息 · Late night";
  if (h < 12) return "早上好，开口练练吧 · Good morning";
  if (h < 18) return "下午好，继续加油 · Good afternoon";
  return "晚上好，继续练习吧 · Good evening";
}

export default function Home() {
  const [featured, ...rest] = scenarios;
  const greeting = greetingFor(new Date());

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Masthead />

      <main className="mx-auto w-full max-w-page flex-1 px-6 py-10 lg:px-20">
        <div className="animate-fade-up">
          <p className="font-display text-2xl text-ink">{greeting}</p>
          <p className="mt-1 font-sc text-muted">
            选择一个场景，开始今天的口语练习。
          </p>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <section className="animate-fade-up lg:col-span-7">
            <p className="eyebrow mb-3">今日推荐 · Featured</p>
            <ScenarioCard scenario={featured} index={1} featured />
          </section>

          <section className="animate-fade-up lg:col-span-5">
            <p className="eyebrow mb-3">目录 · Contents</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {rest.map((s, i) => (
                <ScenarioCard key={s.id} scenario={s} index={i + 2} />
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-page items-center justify-between border-t border-border px-6 py-6 lg:px-20">
        <span className="eyebrow !text-muted">Spoken · AI 英语口语陪练</span>
        <BackendStatus />
      </footer>
    </div>
  );
}
