// AudioWorkletProcessor that downsamples mic input to 16kHz mono Int16 PCM
// and posts base64 frames back to main thread for the Gemini Live API.

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.inputRate = sampleRate;
    this.ratio = this.inputRate / this.targetRate;
    this.buffer = [];
    this.chunkSize = Math.floor(this.targetRate * 0.04); // ~40 ms @ 16k = 640 samples
    this.muted = false;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.muted === 'boolean') this.muted = e.data.muted;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    if (this.muted) return true;

    // Simple linear resample from inputRate to targetRate.
    for (let i = 0; i < channel.length; i += this.ratio) {
      const idx = Math.floor(i);
      const frac = i - idx;
      const s0 = channel[idx] || 0;
      const s1 = channel[idx + 1] || s0;
      let sample = s0 + (s1 - s0) * frac;
      sample = Math.max(-1, Math.min(1, sample));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.buffer.push(int16);
    }

    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const int16Arr = new Int16Array(chunk);
      this.port.postMessage({ type: 'chunk', pcm: int16Arr }, [int16Arr.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
