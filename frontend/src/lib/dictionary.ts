import {
  postDictionaryLookup,
  type DictionaryEntry,
} from "./api";

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const cache = new Map<string, DictionaryEntry>();
const inflight = new Map<string, Promise<DictionaryEntry>>();

export function normalizeDictionaryQuery(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, " ");
  const cleaned = compact.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
  const words = cleaned.match(WORD_RE) ?? [];
  if (
    !cleaned ||
    !words.length ||
    cleaned.length > 80 ||
    words.length > 6
  ) {
    return null;
  }
  return cleaned;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function forSubscriber<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (!signal.aborted) resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function clearDictionarySessionCache(): void {
  cache.clear();
  inflight.clear();
}

export function getDictionaryEntry(
  raw: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> {
  const query = normalizeDictionaryQuery(raw);
  if (!query) return Promise.reject(new Error("Invalid dictionary query"));

  const key = query.toLocaleLowerCase();
  const cached = cache.get(key);
  if (cached) return forSubscriber(Promise.resolve(cached), signal);

  let lookup = inflight.get(key);
  if (!lookup) {
    lookup = postDictionaryLookup(query)
      .then((entry) => {
        cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, lookup);
  }
  return forSubscriber(lookup, signal);
}
