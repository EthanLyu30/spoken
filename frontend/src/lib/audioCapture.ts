export interface CaptureProcessor {
  node: AudioNode;
  disconnect: () => void;
}

export async function createCaptureProcessor(context: AudioContext, onSamples: (samples: Float32Array) => void): Promise<CaptureProcessor> {
  if (context.audioWorklet && typeof AudioWorkletNode === "function") {
    try {
      await context.audioWorklet.addModule(new URL("./capture.worklet.js", import.meta.url).href);
      const node = new AudioWorkletNode(context, "spoken-pcm-capture");
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onSamples(new Float32Array(event.data));
      return { node, disconnect: () => { node.port.onmessage = null; node.port.close(); node.disconnect(); } };
    } catch {
      // Older embedded browsers and restrictive CSPs retain voice capture.
    }
  }
  const node = context.createScriptProcessor(1024, 1, 1);
  node.onaudioprocess = (event) => onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
  return { node, disconnect: () => { node.onaudioprocess = null; node.disconnect(); } };
}
