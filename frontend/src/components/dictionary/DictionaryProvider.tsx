import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeDictionaryQuery } from "../../lib/dictionary";
import {
  DictionaryContext,
  type DictionaryOpenRequest,
} from "./DictionaryContext";
import { DictionaryOverlay } from "./DictionaryOverlay";

export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DictionaryOpenRequest | null>(null);

  const openDictionary = useCallback((next: DictionaryOpenRequest) => {
    const query = normalizeDictionaryQuery(next.query);
    if (!query) return;
    setRequest({ ...next, query });
  }, []);

  useEffect(() => {
    const openSelection = () => {
      window.setTimeout(() => {
        const selection = window.getSelection();
        if (
          !selection ||
          selection.isCollapsed ||
          selection.rangeCount === 0
        ) {
          return;
        }
        const node = selection.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        if (!element?.closest("[data-dictionary-text]")) return;
        const query = normalizeDictionaryQuery(selection.toString());
        if (!query) return;
        openDictionary({
          query,
          rect: selection.getRangeAt(0).getBoundingClientRect(),
          trigger: element.closest("[data-dictionary-text]") as HTMLElement,
        });
      }, 0);
    };

    document.addEventListener("mouseup", openSelection);
    document.addEventListener("touchend", openSelection);
    return () => {
      document.removeEventListener("mouseup", openSelection);
      document.removeEventListener("touchend", openSelection);
    };
  }, [openDictionary]);

  const value = useMemo(() => ({ openDictionary }), [openDictionary]);

  return (
    <DictionaryContext.Provider value={value}>
      {children}
      <DictionaryOverlay
        request={request}
        onClose={() => setRequest(null)}
      />
    </DictionaryContext.Provider>
  );
}
