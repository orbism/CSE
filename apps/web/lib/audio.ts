import type { LabDrive } from "@cse/art";

/**
 * Music in, LabDrive out.
 *
 * Browsers cannot read "whatever the system is playing" directly. Two routes:
 *   share  getDisplayMedia with audio — a Chrome/Edge tab's audio, or the whole
 *          system's where the OS allows (Windows; macOS on recent Chrome).
 *   input  getUserMedia — a mic, or a loopback device (BlackHole, Loopback,
 *          VB-Cable) that carries system audio as an input.
 *
 * Analysis runs on its own animation frame, independent of the engine, so the
 * meters keep moving while the form is paused.
 *
 * ## The pump
 *
 * The kick has its own signal path: a steep band-pass around `kickHz`
 * (default 60 Hz, below most bass lines' body) into a short time-domain
 * analyser. Its RMS is measured against a floor that follows the level between
 * kicks, so a rolling sub doesn't hold the form open — only what rises above
 * it pumps. The form's size follows that envelope directly, frame by frame,
 * which is what makes a four-on-the-floor read as breathing rather than a
 * twitch. Onsets come from the same envelope's rises. Intervals between kicks give a tempo
 * (folded into 75–150 BPM, median of the last dozen), and a flywheel keeps
 * pumping on that tempo through fills and breakdowns where the kick drops out.
 * Each beat fires a damped spring: out hard, back past rest, settle — which is
 * what makes it read as a pump rather than a swell.
 */
export type AudioSource = "share" | "input";

export interface AudioTuning {
  sensitivity: number;
  /** Size of the beat pulse. */
  pump: number;
  /** Length of the beat pulse; lower is snappier. */
  snap: number;
  /** Centre of the kick band, Hz. Lower isolates the kick from the bass line. */
  kickHz: number;
  /** Squash-and-stretch on the beat. */
  squash: number;
  /** Continuous swell with the bass level, under the beats. */
  breathe: number;
  feedback: number;
  spin: number;
  /** Spin kick on each beat. */
  whip: number;
  /** Roll on hi-hat hits. */
  wobble: number;
  /** Raster tear on hats and beats. */
  glitch: number;
  /** Colour-inversion strobe on beats. Off by default: photosensitivity. */
  flash: number;
}

export const DEFAULT_TUNING: AudioTuning = {
  sensitivity: 1,
  pump: 1,
  snap: 1,
  kickHz: 60,
  squash: 0.6,
  breathe: 0.5,
  feedback: 1,
  spin: 1,
  whip: 1,
  wobble: 1,
  glitch: 0.35,
  flash: 0,
};

/** Hz ranges: bass level, mids level, highs level, hat flux. */
const LEVELS: [number, number][] = [
  [20, 150],
  [250, 2000],
  [4000, 12000],
];
const HAT: [number, number] = [6000, 14000];

const NO_PROCESSING = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Easing time constant per output, seconds. Every output glides toward its
 * target instead of landing on it in one frame: short enough that the pump
 * still punches, long enough that nothing steps. Only extreme slider settings
 * should read as jarring.
 */
const EASE: Record<keyof LabDrive, number> = {
  pulse: 0.03,
  squash: 0.05,
  feedback: 0.15,
  spin: 0.12,
  roll: 0.1,
  glitch: 0.04,
  flash: 0.035,
};

class Onset {
  avg = 0;
  last = -1;
  constructor(
    private ratio: number,
    private floor: number,
    private gap: number,
  ) {}
  /** True when `flux` jumps clear of its running average. */
  hit(flux: number, t: number): boolean {
    const on = flux > this.avg * this.ratio + this.floor && t - this.last > this.gap;
    this.avg += (flux - this.avg) * 0.08;
    if (on) this.last = t;
    return on;
  }
}

export class AudioDrive {
  tuning: AudioTuning = DEFAULT_TUNING;

  /** Raw spectrum, 0..255 per bin, for meters. */
  readonly bins: Uint8Array<ArrayBuffer>;
  readonly binHz: number;
  /** Normalised bass / mids / highs, 0..1. */
  readonly level = [0, 0, 0];
  /** Beat spring, -~0.3..1. */
  beat = 0;
  bpm = 0;
  out: LabDrive = { pulse: 0, squash: 0, feedback: 0, spin: 0, roll: 0, glitch: 0, flash: 0 };

  private analyser: AnalyserNode;
  private prev: Uint8Array<ArrayBuffer>;
  private peak = [0.05, 0.05, 0.05];
  private kick = new Onset(1.5, 0.08, 0.25);
  private kickFilters: BiquadFilterNode[];
  private kickAnalyser: AnalyserNode;
  private kickBuf: Float32Array<ArrayBuffer>;
  private kickHz = 0;
  private kickPeak = 1e-4;
  /** Normalised level between kicks; what a kick has to rise above. */
  private kickBed = 0;
  private kickShape = 0;
  /** The pump envelope, 0..1. */
  kickEnv = 0;
  private hat = new Onset(1.8, 0.01, 0.07);
  private intervals: number[] = [];
  private kickPrev = -10;
  private lastBeat = -10;
  private strength = 0;
  private lastHat = -10;
  private hatSign = 1;
  private raf = 0;
  private lastT = 0;

  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    onEnded: () => void,
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    // Low: flux needs the attack, the envelopes below do the smoothing.
    this.analyser.smoothingTimeConstant = 0.3;
    // Not connected to the destination: listening only, no echo.
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.analyser);

    // Kick path: 12 dB/oct high-pass, 24 dB/oct low-pass, then a short window.
    this.kickFilters = (["highpass", "lowpass", "lowpass"] as BiquadFilterType[]).map((type) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = 0.8;
      return f;
    });
    this.kickAnalyser = ctx.createAnalyser();
    this.kickAnalyser.fftSize = 1024; // ~21 ms at 48 kHz
    this.kickBuf = new Float32Array(this.kickAnalyser.fftSize);
    let node: AudioNode = src;
    for (const f of this.kickFilters) node = node.connect(f);
    node.connect(this.kickAnalyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.prev = new Uint8Array(this.bins.length);
    this.binHz = ctx.sampleRate / this.analyser.fftSize;
    for (const t of stream.getAudioTracks()) t.addEventListener("ended", onEnded);
    this.schedule();
  }

  /** Frames come from `host` — the pop-out window while there is one, since a hidden tab gets none. */
  private host: Window = window;

  private schedule() {
    const loop = () => {
      this.analyse(performance.now() / 1000);
      this.raf = this.host.requestAnimationFrame(loop);
    };
    this.raf = this.host.requestAnimationFrame(loop);
  }

  setFrameWindow(win: Window | null) {
    this.host.cancelAnimationFrame(this.raf);
    this.host = win ?? window;
    this.schedule();
  }

  static async open(source: AudioSource, onEnded: () => void): Promise<AudioDrive> {
    const ctx = new AudioContext();
    let stream: MediaStream;
    try {
      stream =
        source === "share"
          ? await navigator.mediaDevices.getDisplayMedia({
              video: true, // required by Chrome even for audio; dropped below
              audio: NO_PROCESSING,
              systemAudio: "include",
            } as DisplayMediaStreamOptions)
          : await navigator.mediaDevices.getUserMedia({ audio: NO_PROCESSING });
    } catch (err) {
      ctx.close();
      throw err;
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      ctx.close();
      throw new Error("No audio in that share. Pick a tab or screen and tick “Share audio”.");
    }
    return new AudioDrive(ctx, stream, onEnded);
  }

  /** For the engine: the latest drive. */
  read = (): LabDrive => this.out;

  private range([lo, hi]: [number, number]): [number, number] {
    return [
      Math.max(1, Math.round(lo / this.binHz)),
      Math.min(this.bins.length - 1, Math.round(hi / this.binHz)),
    ];
  }

  /** Mean positive rise across a band since last frame, 0..1. */
  private flux(band: [number, number]): number {
    const [lo, hi] = this.range(band);
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += Math.max(0, this.bins[i] - this.prev[i]);
    return sum / ((hi - lo + 1) * 255);
  }

  private analyse(t: number) {
    this.prev.set(this.bins);
    this.analyser.getByteFrequencyData(this.bins);

    for (let b = 0; b < 3; b++) {
      const [lo, hi] = this.range(LEVELS[b]);
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += this.bins[i];
      const v = sum / ((hi - lo + 1) * 255);
      this.peak[b] = Math.max(v, this.peak[b] * 0.997, 0.05);
      const n = v / this.peak[b];
      // fast attack, slow release
      this.level[b] += (n - this.level[b]) * (n > this.level[b] ? 0.6 : 0.12);
    }

    const T = this.tuning;
    const dt = Math.min(0.1, this.lastT ? t - this.lastT : 0.016);
    this.lastT = t;

    // ---- kick path
    if (T.kickHz !== this.kickHz) {
      this.kickHz = T.kickHz;
      const [hp, lp1, lp2] = this.kickFilters;
      hp.frequency.value = T.kickHz * 0.6;
      lp1.frequency.value = lp2.frequency.value = T.kickHz * 1.6;
    }
    this.kickAnalyser.getFloatTimeDomainData(this.kickBuf);
    let sq = 0;
    for (const v of this.kickBuf) sq += v * v;
    const rms = Math.sqrt(sq / this.kickBuf.length);
    this.kickPeak = Math.max(rms, this.kickPeak * 0.998, 1e-4);
    const n = rms / this.kickPeak;
    // The bed drops fast and rises slowly, so it settles on the between-kick level.
    this.kickBed += (n - this.kickBed) * (n < this.kickBed ? 0.3 : 0.01);
    const shape = clamp((n - this.kickBed) / (1 - this.kickBed + 1e-3), 0, 1);
    const rise = Math.max(0, shape - this.kickShape);
    this.kickShape = shape;
    this.kickEnv = Math.max(shape, this.kickEnv * Math.exp(-dt / (0.07 * T.snap)));

    const period = this.bpm ? 60 / this.bpm : 0;

    if (this.kick.hit(rise, t) && shape > 0.45) {
      const since = t - this.kickPrev;
      if (since < 2) {
        let ivl = since;
        while (ivl > 0.8) ivl /= 2;
        while (ivl < 0.4) ivl *= 2;
        this.intervals.push(ivl);
        if (this.intervals.length > 12) this.intervals.shift();
        if (this.intervals.length >= 4) {
          const sorted = [...this.intervals].sort((a, b) => a - b);
          this.bpm = Math.round(60 / sorted[sorted.length >> 1]);
        }
      }
      this.kickPrev = t;
      // A real kick just after a flywheel beat only corrects it; restarting the
      // spring there would stutter.
      if (t - this.lastBeat > 0.1) this.lastBeat = t;
      this.strength = clamp(shape, 0.4, 1);
    } else if (period && t - this.lastBeat > period * 1.08 && t - this.kickPrev < 4) {
      // Flywheel: the kick dropped out but the track hasn't — keep the pump on tempo.
      this.lastBeat = t;
      this.strength *= 0.85;
    } else if (t - this.kickPrev > 4) {
      this.bpm = 0;
      this.intervals.length = 0;
    }

    if (this.hat.hit(this.flux(HAT), t) && this.level[2] > 0.3) {
      this.lastHat = t;
      this.hatSign = -this.hatSign;
    }

    const s = T.sensitivity;
    const since = t - this.lastBeat;
    const tau = 0.09 * T.snap;
    // Damped spring: out, back past rest, settle.
    this.beat = since < tau * 8 ? Math.exp(-since / tau) * Math.cos((Math.PI * since) / (2.5 * tau)) : 0;
    const b = this.beat * this.strength;
    const up = Math.max(0, b);
    const whip = Math.exp(-since / 0.25) * this.strength;
    const hat = Math.exp(-(t - this.lastHat) / 0.12);
    const [bass, mids, highs] = this.level;

    const target: LabDrive = {
      // the kick envelope sizes the form; the spring adds the contraction after
      pulse: s * (T.pump * (0.2 * this.kickEnv + 0.08 * Math.min(0, b)) + T.breathe * 0.08 * bass),
      squash: s * T.squash * 0.12 * b,
      feedback: s * T.feedback * (0.5 * mids + 0.25 * up),
      spin: s * (T.spin * 1.2 * highs + T.whip * 3 * whip),
      roll: s * T.wobble * (0.12 * hat * this.hatSign + 0.03 * highs * Math.sin(t * 7)),
      glitch: clamp(s * T.glitch * (0.8 * hat + 0.4 * up), 0, 1),
      flash: clamp(s * T.flash * up * up, 0, 1),
    };
    const next = { ...this.out };
    for (const k of Object.keys(EASE) as (keyof LabDrive)[]) {
      next[k] += (target[k] - next[k]) * (1 - Math.exp(-dt / EASE[k]));
    }
    this.out = next;
  }

  close() {
    this.host.cancelAnimationFrame(this.raf);
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close();
  }
}
