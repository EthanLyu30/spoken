import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mic } from "lucide-react";
import { getScenario } from "../data/scenarios";

export default function Conversation() {
  const { scenarioId } = useParams();
  const scenario = scenarioId ? getScenario(scenarioId) : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      {/* Hairline top bar — collapses the editorial chrome into a quiet rail. */}
      <div className="mx-auto flex w-full max-w-page items-center justify-between border-b border-border px-6 py-5 lg:px-20">
        <span className="font-display text-lg">{scenario?.title ?? "Practice"}</span>
        <Link to="/" className="eyebrow !text-primary inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> END 结束
        </Link>
      </div>

      {/* Reading room — calm, single focal point. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="eyebrow">Reading Room · 对话练习</p>
        <h1 className="mt-4 max-w-reading text-3xl md:text-4xl">
          {scenario ? (
            <>
              {scenario.titleZh} · <span className="hl-static">{scenario.title}</span>
            </>
          ) : (
            "Scenario"
          )}
        </h1>
        <p className="mt-3 max-w-md font-sc text-muted">
          {scenario?.subtitle ?? "实时语音对话即将上线。"}
        </p>

        {/* Mic — the one element that "glows" in this design. */}
        <div className="mt-12 flex h-24 w-24 items-center justify-center rounded-full border-2 border-ink bg-surface shadow-mic">
          <Mic className="h-8 w-8 text-primary" />
        </div>
        <p className="eyebrow !text-muted mt-6">实时语音对话 · Coming soon</p>
      </div>
    </div>
  );
}
