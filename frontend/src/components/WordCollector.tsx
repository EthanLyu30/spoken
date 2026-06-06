import { useEffect, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { postWord } from "../lib/api";

/**
 * Select any word/phrase inside a [data-collect] region (chat, report, daily
 * lines) to pop a "+ 生词本" chip and save it. Lets learners grab unknown words
 * as they read instead of retyping them.
 */
const MAX_LEN = 40;

function clean(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t || t.length > MAX_LEN || !/[A-Za-z]/.test(t) || t.split(" ").length > 5) return null;
  return t.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
}

export function WordCollector() {
  const [text, setText] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  useEffect(() => {
    function onSelect() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setText(null);
        return;
      }
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el || !el.closest("[data-collect]")) {
        setText(null);
        return;
      }
      const cleaned = clean(sel.toString());
      if (!cleaned) {
        setText(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setText(cleaned);
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
      setState("idle");
    }
    document.addEventListener("mouseup", onSelect);
    document.addEventListener("touchend", onSelect);
    return () => {
      document.removeEventListener("mouseup", onSelect);
      document.removeEventListener("touchend", onSelect);
    };
  }, []);

  async function add() {
    if (!text || state === "saving") return;
    setState("saving");
    try {
      await postWord({ text, kind: "word" });
      setState("done");
      window.setTimeout(() => {
        setText(null);
        window.getSelection()?.removeAllRanges();
      }, 1000);
    } catch {
      setState("idle");
    }
  }

  if (!text || !pos) return null;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the selection alive on click
      onClick={add}
      className="fixed z-50 inline-flex max-w-[16rem] -translate-x-1/2 -translate-y-full items-center gap-1.5 truncate rounded-full bg-coral px-3.5 py-2 text-xs font-bold text-primary-fg shadow-pop"
      style={{ left: pos.x, top: pos.y - 8 }}
    >
      {state === "done" ? (
        <>
          <Check className="h-3.5 w-3.5" /> 已加入生词本
        </>
      ) : state === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加入中…
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5" /> 加入生词本「{text}」
        </>
      )}
    </button>
  );
}
