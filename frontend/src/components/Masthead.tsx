function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

interface MastheadProps {
  bandScore?: number;
  streak?: number;
}

export function Masthead({ bandScore = 82, streak = 4 }: MastheadProps) {
  const today = formatDate(new Date());

  return (
    <header className="mx-auto w-full max-w-page px-6 pt-8 lg:px-20">
      <div className="flex items-center justify-between">
        <span className="eyebrow !text-muted">今天 · {today}</span>
        <span className="flex items-center gap-5">
          <span className="eyebrow !text-muted">连续 {streak} 天</span>
          <span className="eyebrow">
            总分{" "}
            <span className="tabnum font-display text-base text-primary">
              {bandScore}
            </span>
          </span>
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between border-b border-ink pb-5">
        <div>
          <h1 className="text-5xl tracking-tight lg:text-7xl">Spoken</h1>
          <p className="eyebrow mt-2">Practice Edition · 口语陪练 · No.07</p>
        </div>
        <p className="hidden max-w-xs text-right font-sc text-sm text-muted md:block">
          在真实场景里开口说英语，
          <br />
          获得发音、语法与表达的量化反馈。
        </p>
      </div>
    </header>
  );
}
