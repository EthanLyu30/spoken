import { createContext, useContext } from "react";

export interface DictionaryOpenRequest {
  query: string;
  rect: DOMRect;
  trigger: HTMLElement | null;
}

export interface DictionaryContextValue {
  openDictionary: (request: DictionaryOpenRequest) => void;
}

export const DictionaryContext =
  createContext<DictionaryContextValue | null>(null);

export function useDictionary(): DictionaryContextValue {
  const value = useContext(DictionaryContext);
  if (!value) {
    throw new Error("useDictionary must be used inside DictionaryProvider");
  }
  return value;
}
