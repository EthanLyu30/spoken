/**
 * Streaming ASR client for call mode.
 *
 * Opens a WebSocket to the backend relay (`/api/asr/stream`), which forwards
 * audio to iFlytek IAT and pushes back the transcript *as it's recognised* —
 * so the UI can show live captions while the user is still speaking, and the
 * reply can start the instant they stop (no "upload the whole clip and wait").
 *
 * One connection serves the whole call; each utterance is `send()` frames then
 * `finishUtterance()`. If anything fails the caller falls back to the buffered
 * `postAsr` path, so streaming is a pure enhancement, never a hard dependency.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function streamUrl(): string {
  const path = "/api/asr/stream";
  if (BASE_URL) return BASE_URL.replace(/^http/, "ws") + path; // http→ws, https→wss
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

export interface AsrStream {
  /** Forward a chunk of 16 kHz/16-bit/mono PCM for the current utterance. */
  send: (pcm: ArrayBuffer) => void;
  /** End the current utterance; resolves with the final transcript (or ""). */
  finishUtterance: () => Promise<string>;
  /** Close the connection and end the call. */
  close: () => void;
}

export interface AsrStreamCallbacks {
  /** Growing transcript for the in-progress utterance (live captions). */
  onPartial: (text: string) => void;
  /** The connection dropped — the caller should fall back to buffered ASR. */
  onClose?: () => void;
}

const READY_TIMEOUT_MS = 5000;
const FINAL_TIMEOUT_MS = 8000;

/**
 * Open a streaming ASR session. Resolves once the server handshake succeeds;
 * rejects if streaming is unavailable (unconfigured creds, network, timeout),
 * which is the signal to fall back to the buffered endpoint.
 */
export function openAsrStream(
  cb: AsrStreamCallbacks,
  language = "en_us",
): Promise<AsrStream> {
  return new Promise<AsrStream>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(streamUrl());
    } catch (err) {
      reject(err);
      return;
    }
    ws.binaryType = "arraybuffer";

    let ready = false;
    let pendingFinal: ((text: string) => void) | null = null;

    const settlePending = (text: string) => {
      const r = pendingFinal;
      pendingFinal = null;
      r?.(text);
    };

    const readyTimer = setTimeout(() => {
      if (!ready) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error("asr stream handshake timed out"));
      }
    }, READY_TIMEOUT_MS);

    const api: AsrStream = {
      send: (pcm) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(pcm);
          } catch {
            /* a dropped frame is fine; iFlytek tolerates gaps */
          }
        }
      },
      finishUtterance: () =>
        new Promise<string>((res) => {
          if (ws.readyState !== WebSocket.OPEN) {
            res("");
            return;
          }
          pendingFinal = res;
          try {
            ws.send(JSON.stringify({ type: "end" }));
          } catch {
            settlePending("");
            return;
          }
          // Don't hang the turn if the final never arrives.
          setTimeout(() => {
            if (pendingFinal === res) settlePending("");
          }, FINAL_TIMEOUT_MS);
        }),
      close: () => {
        try {
          ws.send(JSON.stringify({ type: "close" }));
        } catch {
          /* ignore */
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
    };

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "start", language }));
      } catch {
        /* onclose/onerror will reject */
      }
    };

    ws.onmessage = (ev) => {
      let msg: { type?: string; text?: string; message?: string };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (!ready) {
        if (msg.type === "ready") {
          ready = true;
          clearTimeout(readyTimer);
          resolve(api);
        } else if (msg.type === "error") {
          clearTimeout(readyTimer);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error(msg.message || "asr stream unavailable"));
        }
        return;
      }
      if (msg.type === "partial") cb.onPartial(msg.text ?? "");
      else if (msg.type === "final") settlePending(msg.text ?? "");
      else if (msg.type === "error") settlePending("");
    };

    ws.onerror = () => {
      if (!ready) {
        clearTimeout(readyTimer);
        reject(new Error("asr stream connection error"));
      }
    };

    ws.onclose = () => {
      clearTimeout(readyTimer);
      settlePending(""); // unblock any in-flight finishUtterance
      if (ready) cb.onClose?.();
      else reject(new Error("asr stream closed before ready"));
    };
  });
}
