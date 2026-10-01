"use client";

import { useSyncExternalStore } from "react";

/**
 * The site radio: one audio element for the whole site, played through a Web
 * Audio graph so the header spectrum and the Lab can read the signal.
 *
 *   element -> source -> fade -+-> volume -> speakers
 *                              +-> analyser (header spectrum)
 *                              +-> whatever the Lab taps
 *
 * Play and pause fade in and out, and the visuals fade with them; the volume
 * slider comes after the split, so turning it down never flattens them. All three stations send CORS headers, which is what
 * lets Web Audio read them at all: a stream without them analyses as silence.
 *
 * Never autoplays. The graph is built on the first play, inside the click,
 * which is when browsers allow an AudioContext to start.
 */

const SERVER: RadioState = {
  station: 0,
  playing: false,
  loading: false,
  volume: 0.8,
  title: "",
  error: "",
  fed: false,
};

interface Station {
  name: string;
  url: string;
  /** Where to ask what's on; parsed by `title`. */
  api: string;
  title: (json: any) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** AzuraCast's now-playing JSON, with the DJ named when someone is live. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const azura = (d: any) => {
  const song = d?.now_playing?.song?.text ?? "";
  return d?.live?.is_live && d.live.streamer_name ? `LIVE ${d.live.streamer_name} · ${song}` : song;
};

export const STATIONS: Station[] = [
  {
    name: "DNBRADIO",
    url: "https://azura.drmnbss.org/listen/dnbradio/radio.mp3",
    api: "https://azura.drmnbss.org/api/nowplaying/dnbradio",
    title: azura,
  },
  {
    name: "BADRADIO",
    url: "https://s2.radio.co/s2b2b68744/listen",
    api: "https://public.radio.co/stations/s2b2b68744/status",
    title: (d) => d?.current_track?.title ?? "",
  },
  {
    name: "dirty.radio ch1",
    url: "https://live.dirty.radio/ch1/",
    api: "https://live.dirty.radio/api/nowplaying/ch1",
    title: azura,
  },
];

/** Spectrum bins from some other input (the Lab's mic or shared tab). */
export interface SpectrumFeed {
  bins: Uint8Array;
  binHz: number;
}

export interface RadioState {
  station: number;
  playing: boolean;
  /** Pressed play, waiting for the stream to start. */
  loading: boolean;
  volume: number;
  title: string;
  error: string;
  /** Another input is feeding the spectrum (see `setFeed`). */
  fed: boolean;
}

const VOLUME_KEY = "cse-radio-volume";
const POLL_MS = 20_000;
const FADE_IN = 1.4;
const FADE_OUT = 0.9;

class Radio {
  state: RadioState = { ...SERVER };
  analyser: AnalyserNode | null = null;
  /** When set, the spectrum shows this instead of the radio. */
  feed: SpectrumFeed | null = null;
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private fade: GainNode | null = null;
  private gain: GainNode | null = null;
  private poll = 0;
  private stopTimer = 0;
  /** Volume to restore on unmute. */
  private unmuted = 0.8;

  constructor() {
    try {
      const v = Number(localStorage.getItem(VOLUME_KEY));
      if (v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null) this.state.volume = v;
      if (this.state.volume > 0) this.unmuted = this.state.volume;
    } catch {
      // blocked storage: default volume
    }
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.preload = "none";
    a.addEventListener("playing", () => this.set({ playing: true, loading: false, error: "" }));
    a.addEventListener("pause", () => this.set({ playing: false, loading: false }));
    a.addEventListener("error", () => {
      if (a.getAttribute("src")) this.set({ playing: false, loading: false, error: "stream unavailable" });
    });
    this.audio = a;
    this.refreshTitle();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.state;

  private set(patch: Partial<RadioState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private graph() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.source = ctx.createMediaElementSource(this.audio);
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.state.volume;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.72;
    this.source.connect(this.fade);
    this.fade.connect(this.gain).connect(ctx.destination);
    this.fade.connect(this.analyser);
    return (this.ctx = ctx);
  }

  private ramp(to: number, seconds: number) {
    const g = this.fade!.gain;
    const now = this.ctx!.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(to, now + seconds);
  }

  /**
   * Call from a click. A fresh start loads the stream anew, so it lands on the
   * live edge rather than a stale buffer; pressing play mid fade-out just turns
   * the fade back around.
   */
  play() {
    const ctx = this.graph();
    ctx.resume();
    clearTimeout(this.stopTimer);
    this.stopTimer = 0;
    if (!this.audio.getAttribute("src")) {
      this.fade!.gain.value = 0;
      this.set({ loading: true, error: "" });
      this.audio.src = STATIONS[this.state.station].url;
      this.audio.play().catch(() => this.set({ loading: false, error: "couldn't start the stream" }));
    } else if (!this.audio.paused) this.set({ playing: true });
    this.ramp(1, FADE_IN);
    this.startPolling();
  }

  /** Fades out, then stops downloading: a paused live stream would otherwise keep buffering. */
  pause() {
    this.set({ playing: false, loading: false });
    clearInterval(this.poll);
    this.poll = 0;
    if (!this.ctx || !this.audio.getAttribute("src")) return;
    this.ramp(0, FADE_OUT);
    clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.unload(), FADE_OUT * 1000);
  }

  private unload() {
    this.stopTimer = 0;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  toggle() {
    if (this.state.playing || this.state.loading) this.pause();
    else this.play();
  }

  /** Next or previous station; if one was playing, the new one fades in. */
  step(dir: 1 | -1) {
    const was = this.state.playing || this.state.loading;
    this.set({ station: (this.state.station + dir + STATIONS.length) % STATIONS.length, title: "" });
    this.refreshTitle();
    if (was) {
      clearTimeout(this.stopTimer);
      this.unload();
      this.play();
    }
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v;
    if (v > 0) this.unmuted = v;
    this.set({ volume: v });
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      // fine: volume just won't persist
    }
  }

  toggleMute() {
    this.setVolume(this.state.volume > 0 ? 0 : this.unmuted || 0.8);
  }

  /** Point the spectrum at another input, or back at the radio with null. */
  setFeed(feed: SpectrumFeed | null) {
    this.feed = feed;
    this.set({ fed: !!feed });
  }

  /**
   * The radio as an input for the Lab: its context and source node, starting
   * playback if needed. Call from a click.
   */
  tap(): { ctx: AudioContext; source: AudioNode } {
    if (!this.state.playing && !this.state.loading) this.play();
    return { ctx: this.ctx!, source: this.fade! };
  }

  private startPolling() {
    if (this.poll) return;
    this.poll = window.setInterval(() => this.refreshTitle(), POLL_MS);
  }

  private async refreshTitle() {
    const i = this.state.station;
    try {
      const res = await fetch(STATIONS[i].api, { cache: "no-store" });
      const title = STATIONS[i].title(await res.json());
      if (this.state.station === i) this.set({ title });
    } catch {
      // keep whatever was showing; the next poll may do better
    }
  }
}

let radio: Radio | null = null;

/** The site radio singleton. Client only. */
export function getRadio(): Radio {
  return (radio ??= new Radio());
}


export function useRadio(): RadioState {
  return useSyncExternalStore(
    (fn) => getRadio().subscribe(fn),
    () => getRadio().snapshot(),
    () => SERVER,
  );
}
