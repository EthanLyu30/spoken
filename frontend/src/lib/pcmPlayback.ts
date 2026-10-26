export interface PcmPlayback {
  push: (chunk: Uint8Array) => void;
  finish: () => Promise<void>;
  stop: () => void;
}

/** Schedule little-endian 16 kHz PCM without waiting for the complete file. */
export function createPcmPlayback(context: AudioContext, onStarted?: () => void): PcmPlayback {
  const sources = new Set<AudioBufferSourceNode>();
  let nextTime = context.currentTime + 0.08; // short jitter buffer
  let carry: number | undefined;
  let ended = false;
  let closed = false;
  let received = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => { settle = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(startTimer);
    void context.close().catch(() => undefined).then(settle);
  };
  const stop = () => {
    for (const source of sources) { try { source.stop(); } catch { /* already ended */ } }
    sources.clear();
    close();
  };
  return {
    push: (chunk) => {
      if (closed || ended) return;
      let bytes = chunk;
      if (carry !== undefined) {
        bytes = new Uint8Array(chunk.length + 1);
        bytes[0] = carry;
        bytes.set(chunk, 1);
        carry = undefined;
      }
      if (bytes.length % 2) carry = bytes[bytes.length - 1];
      const count = Math.floor(bytes.length / 2);
      if (!count) return;
      const buffer = context.createBuffer(1, count, 16_000);
      const samples = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      sources.add(source);
      source.onended = () => { sources.delete(source); if (ended && !sources.size) close(); };
      const at = Math.max(nextTime, context.currentTime + 0.01);
      source.start(at);
      nextTime = at + buffer.duration;
      if (!received) startTimer = setTimeout(() => { if (!closed) onStarted?.(); }, Math.max(0, (at - context.currentTime) * 1000));
      received = true;
    },
    finish: () => {
      if (closed) return done;
      ended = true;
      if (carry !== undefined || !received) {
        stop();
        return Promise.reject(new Error(carry !== undefined ? "Incomplete PCM sample" : "No audio received"));
      }
      if (!sources.size) close();
      return done;
    },
    stop,
  };
}
