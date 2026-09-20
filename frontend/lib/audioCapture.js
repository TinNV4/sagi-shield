// Sagi Shield - live audio capture (browser, reusable).
// Mic -> 16 kHz mono PCM16 chunks (100 ms) -> WebSocket /ws/live.
// Usage:
//   const guard = await startLiveGuard("wss://<cloud-run-host>/ws/live?lang=ja", (msg) => render(msg));
//   guard.stop();

const WORKLET = `
class PcmWorklet extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    // naive downsample to 16 kHz (good enough for speech)
    for (; this.pos < ch.length; this.pos += this.ratio) this.buf.push(ch[Math.floor(this.pos)]);
    this.pos -= ch.length;
    if (this.buf.length >= 1600) {                 // 100 ms @ 16 kHz
      const pcm = new Int16Array(1600);
      for (let i = 0; i < 1600; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.buf = this.buf.slice(1600);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);`;

export async function startLiveGuard(wsUrl, onRisk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,   // we WANT the other party's voice from the speaker
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => onRisk(JSON.parse(e.data));   // {risk_score, risk_level, trigger_phrase, advice}
  node.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data); };
  src.connect(node);

  // keep screen on during a call (supported browsers only)
  let wake = null;
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}

  return {
    stop() {
      src.disconnect(); node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close(); ws.close(); wake?.release();
    },
  };
}
