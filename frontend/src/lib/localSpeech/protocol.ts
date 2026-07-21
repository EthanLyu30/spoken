export interface LocalWorkerRequest {
  id: number;
  type: string;
  payload?: unknown;
}

export type LocalWorkerResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }
  | { type: "progress"; model: string; progress: unknown };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
