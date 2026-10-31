type Flight<T> = {
  controller: AbortController;
  promise: Promise<T>;
  readers: number;
  settled: boolean;
};
type Entry<T> = { value: T; at: number } | { flight: Flight<T> };
const abortError = () => new DOMException("Read abandoned or obsolete", "AbortError");

/** Bounded metadata only. Each reader owns its cancellation, not the transport. */
export class ReadResource {
  private entries = new Map<string, Entry<unknown>>();

  clear(): void {
    for (const entry of this.entries.values()) {
      if ("flight" in entry) entry.flight.controller.abort();
    }
    this.entries.clear();
  }

  read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, valid: () => boolean,
    signal?: AbortSignal, force = false): Promise<T> {
    if (signal?.aborted || !valid()) return Promise.reject(abortError());
    const cached = this.entries.get(key) as Entry<T> | undefined;
    if (!force && cached && "value" in cached && Date.now() - cached.at < 30_000) {
      return Promise.resolve().then(() => {
        if (signal?.aborted || !valid()) throw abortError();
        return cached.value;
      });
    }
    let flight = !force && cached && "flight" in cached ? cached.flight : undefined;
    if (!flight) {
      // Removing a completed value now also makes an abandoned forced refresh retryable.
      this.entries.delete(key);
      while (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
      const controller = new AbortController();
      flight = { controller, readers: 0, settled: false, promise: undefined! };
      const entry = { flight };
      this.entries.set(key, entry);
      const current = flight;
      const ownsEntry = () => this.entries.get(key) === entry;
      try {
        current.promise = load(controller.signal);
      } catch (error) {
        current.promise = Promise.reject(error);
      }
      current.promise = current.promise.then(value => {
        if (controller.signal.aborted || !valid()) throw abortError();
        if (ownsEntry()) this.entries.set(key, { value, at: Date.now() });
        return value;
      }).finally(() => {
        current.settled = true;
        if (ownsEntry()) this.entries.delete(key);
      });
    }
    const current = flight;
    current.readers++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, value?: T) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", cancelled);
        current.controller.signal.removeEventListener("abort", cancelled);
        current.readers--;
        if (!current.settled && current.readers === 0) {
          const entry = this.entries.get(key);
          if (entry && "flight" in entry && entry.flight === current) this.entries.delete(key);
          current.controller.abort();
        }
        if (error !== undefined) reject(error); else resolve(value!);
      };
      const cancelled = () => finish(abortError());
      signal?.addEventListener("abort", cancelled, { once: true });
      current.controller.signal.addEventListener("abort", cancelled, { once: true });
      current.promise.then(value => finish(undefined, value), error => finish(error));
    });
  }
}
