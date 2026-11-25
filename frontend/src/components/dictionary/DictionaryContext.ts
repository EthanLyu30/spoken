import { createContext, useContext } from "react";
import type { WordCollectionOrigin } from "../../lib/api";

export interface DictionaryOpenRequest {
  query: string;
  rect: DOMRect;
  trigger: HTMLElement | null;
  origin?: WordCollectionOrigin;
}

export interface DictionaryContextValue {
  openDictionary: (request: DictionaryOpenRequest) => void;
}

export const DictionaryContext =
  createContext<DictionaryContextValue | null>(null);

export const DictionarySceneContext = createContext<WordCollectionOrigin | undefined>(undefined);
// Selection events are handled above the React text component.
export const dictionaryTextOrigins = new WeakMap<HTMLElement, WordCollectionOrigin>();

export function useDictionary(): DictionaryContextValue {
  const value = useContext(DictionaryContext);
  if (!value) {
    throw new Error("useDictionary must be used inside DictionaryProvider");
  }
  return value;
}
