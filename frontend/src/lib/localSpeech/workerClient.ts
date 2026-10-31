import type { LocalWorkerRequest, LocalWorkerResponse } from "./protocol";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Small RPC layer shared by the isolated model workers. */
export class LocalModelWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly progressListeners = new Set<(progress: unknown) => void>();

  constructor(private readonly createWorker: () => Worker) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onWorkerError);
    this.worker = worker;
    return worker;
  }

  private readonly onMessage = (event: MessageEvent<LocalWorkerResponse>) => {
    const message = event.data;
    if (!("id" in message)) {
      if (message.type === "progress") this.progressListeners.forEach(listener => listener(message.progress));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else {
      const error = new Error(message.error);
      pending.reject(error);
      this.dispose(error); // Retry must get a fresh model, including failed cached promises.
    }
  };

  private readonly onWorkerError = () => {
    this.dispose(new Error("Local speech worker failed"));
  };

  subscribeProgress(listener: (progress: unknown) => void): () => void {
    this.progressListeners.add(listener);
    return () => { this.progressListeners.delete(listener); };
  }

  request<T>(
    type: string,
    payload?: unknown,
    transfer: Transferable[] = [],
    timeoutMs = 60_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.dispose(new Error(`Local speech worker timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      const message: LocalWorkerRequest = { id, type, payload };
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  dispose(error = new Error("Local speech worker stopped")): void {
    this.failAll(error);
    if (!this.worker) return;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onWorkerError);
    this.worker.terminate();
    this.worker = null;
  }
}
