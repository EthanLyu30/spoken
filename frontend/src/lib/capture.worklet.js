/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class SpokenPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(Math.round(sampleRate * 0.02));
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.frame[this.offset++] = input[i];
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Float32Array(Math.round(sampleRate * 0.02));
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("spoken-pcm-capture", SpokenPcmCapture);
