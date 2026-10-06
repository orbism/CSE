"use client";


/**
 * Exporters for a Form: still PNG, looping GIF, looping MP4.
 *
 * Every frame is re-rendered by the engine at the target size — nothing is
 * upscaled from the on-screen canvas. Frames are sampled over exactly one
 * revolution via `captureLoopFrame`, which suppresses the X nod so the last
 * frame meets the first.
 */

export const LOOP_SIZE = 400;

/**
 * Seconds for one full revolution, shared by both loops so a GIF and an MP4 of
 * the same Form turn at the same rate.
 *
 * Frame counts follow from this and the frame rate. Raising the rate alone
 * would only shorten the loop; what makes the rotation read as slow and smooth
 * is more frames spread over a longer revolution — at 24 frames the step was
 * 15 degrees and the motion strobed.
 */
export const PNG_SIZE = 2000;

/**
 * GIF stores per-frame delay in hundredths of a second, so only rates that
 * divide 100 cleanly keep a loop at its stated length. Offering 24fps here
 * would quietly produce a 4.16cs delay and a loop slightly off its label.
 */
export const GIF_RATES = [10, 12.5, 20, 25] as const;
export const MP4_RATES = [24, 30, 60] as const;

/** Readout text only fits above COMPACT_BELOW (560); 400 gets tags alone. */
export const GIF_SIZES = [400, 800, 1200] as const;
export const MP4_SIZES = [640, 1080, 2048] as const;

export const DEFAULT_GIF_FPS = 20;
export const DEFAULT_MP4_FPS = 30;
export const DEFAULT_GIF_SIZE = 400;
export const DEFAULT_MP4_SIZE = 640;
export const DEFAULT_SECONDS = 3;
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 16;

export interface LoopOptions {
  /** Frames per second of the finished loop. */
  fps: number;
  /** Length of one full revolution, in seconds. */
  seconds: number;
  /** Square output edge in pixels. */
  size: number;
  /** Bake the readout callouts into the pixels. */
  hud: boolean;
  /** Revolutions in the file (MP4). One by default. */
  loops?: number;
}

export type LoopSpec = Pick<LoopOptions, "fps" | "seconds" | "size">;

export const frameCount = (o: Pick<LoopOptions, "fps" | "seconds">) =>
  Math.max(2, Math.round(o.fps * o.seconds));

/**
 * Megapixels the encoder has to hold at once.
 *
 * ffmpeg.wasm keeps every input frame in its virtual filesystem until the run
 * finishes, so a long loop at 2K is a memory problem rather than merely a slow
 * one. 2048 x 16s x 60fps is 960 frames — enough to take the tab down.
 */
export const framePressure = (o: LoopSpec) => (frameCount(o) * o.size * o.size) / 1e6;
export const PRESSURE_WARN = 400;
export const PRESSURE_MAX = 1200;
/** Above this the file is too big to be worth sharing, whatever the format. */
export const BYTES_WARN = 20 * 1024 * 1024;

/**
 * Estimated output sizes, interpolated from measured exports.
 *
 * Neither format scales with pixel count in a way a single constant captures,
 * and they do not even move in the same direction:
 *
 *   GIF   0.124 B/px at 400, 0.110 at 800, 0.092 at 1200 — larger frames have
 *         longer flat runs, so LZW does proportionally better.
 *   MP4   0.139 bits/px at 400, 0.206 at 1080, 0.194 at 2048 — it rises then
 *         eases off, which no simple power law fits.
 *
 * So these are the measurements themselves, interpolated between, rather than
 * a curve fitted through them. Shown as approximations because the real figure
 * depends on how much of the frame the Form fills.
 */
const GIF_BYTES_PER_PIXEL: [number, number][] = [
  [400, 0.1243],
  [800, 0.1095],
  [1200, 0.0922],
];

const MP4_BITS_PER_PIXEL: [number, number][] = [
  [400, 0.139],
  [1080, 0.2055],
  [2048, 0.194],
];

function interpolate(table: [number, number][], size: number): number {
  if (size <= table[0][0]) return table[0][1];
  if (size >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (size <= x1) return y0 + ((size - x0) / (x1 - x0)) * (y1 - y0);
  }
  return table[table.length - 1][1];
}

export const estimateGifBytes = (o: LoopSpec) =>
  frameCount(o) * o.size * o.size * interpolate(GIF_BYTES_PER_PIXEL, o.size);

export const estimateMp4Bytes = (o: LoopSpec) =>
  (frameCount(o) * o.size * o.size * interpolate(MP4_BITS_PER_PIXEL, o.size)) / 8;

export type Progress = (stage: string, done: number, total: number) => void;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke on the next tick; Safari needs the URL alive during the click
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copy into a fresh ArrayBuffer-backed view.
 *
 * ffmpeg.wasm and gifenc hand back `Uint8Array<ArrayBufferLike>`, which may in
 * principle be SharedArrayBuffer-backed and is not accepted as a BlobPart.
 */
function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function dataUrlToBytes(url: string): Uint8Array {
  const base64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Yield to the browser so progress can paint between frames. */
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── PNG ──────────────────────────────────────────────────────────────────────

/**
 * The two loop exporters take what they actually use rather than a whole
 * `Engine`, so the Lab's renderer — a different class with no HUD and no
 * archetypes — can hand itself to the same encoders.
 */
export interface StillSource {
  capture(size: number, atTime?: number, hud?: boolean): string;
}
export interface LoopSource {
  captureLoopPixels(size: number, turn: number, hud?: boolean): ImageData;
}
export interface LoopFrameSource {
  captureLoopFrame(
    size: number,
    turn: number,
    hud?: boolean,
    type?: "image/png" | "image/jpeg",
    quality?: number,
  ): string;
}

export async function exportPng(engine: StillSource, name: string, hud = false, size = PNG_SIZE) {
  const url = engine.capture(size, 0, hud);
  download(new Blob([toBlobPart(dataUrlToBytes(url))], { type: "image/png" }), `${name}.png`);
}

// ── GIF ──────────────────────────────────────────────────────────────────────

export async function exportGif(
  engine: LoopSource,
  name: string,
  opts: LoopOptions,
  onProgress?: Progress,
) {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const total = frameCount(opts);
  const delay = Math.round(1000 / opts.fps);

  // One palette for the whole loop rather than per frame. These pieces use a
  // six-ink ANSI ramp plus a background, so 32 entries is already generous, and
  // a shared palette avoids the frame-to-frame colour crawl that per-frame
  // quantisation produces. rgb444 buckets more aggressively, which suits flat
  // glyph fills and compresses far better under LZW.
  //
  // Sampled from a middle frame, then every frame is rendered, quantised and
  // written in one pass. Collecting all the frames first cost 4 bytes a pixel
  // for the whole loop — 400 frames at 1200px is over two gigabytes of
  // ImageData, which took the tab with it.
  const palette = quantize(engine.captureLoopPixels(opts.size, 0.5, opts.hud).data, 32, {
    format: "rgb444",
  });

  const gif = GIFEncoder();
  for (let i = 0; i < total; i++) {
    const frame = engine.captureLoopPixels(opts.size, i / total, opts.hud);
    gif.writeFrame(applyPalette(frame.data, palette, "rgb444"), opts.size, opts.size, {
      palette,
      delay,
    });
    onProgress?.("encoding", i + 1, total);
    await tick();
  }
  gif.finish();

  download(new Blob([toBlobPart(gif.bytes())], { type: "image/gif" }), `${name}.gif`);
}

// ── MP4 ──────────────────────────────────────────────────────────────────────

let ffmpegSingleton: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

/**
 * Load ffmpeg.wasm once, lazily.
 *
 * The core is self-hosted from /public rather than pulled from a CDN: it is a
 * 31 MB wasm blob and a cross-origin fetch would need CORS on someone else's
 * server. This is the single-threaded build, which does not touch
 * SharedArrayBuffer, so the site needs no COOP/COEP headers — those would break
 * the token modal's iframe and the IPFS gateway images.
 */
async function loadFfmpeg(onProgress?: Progress) {
  if (!ffmpegSingleton) {
    ffmpegSingleton = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      onProgress?.("loading encoder", 0, 1);
      await ffmpeg.load({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      });
      return ffmpeg;
    })().catch((e) => {
      ffmpegSingleton = null;
      throw e;
    });
  }
  return ffmpegSingleton;
}

export async function exportMp4(
  engine: LoopFrameSource,
  name: string,
  opts: LoopOptions,
  onProgress?: Progress,
) {
  const ffmpeg = await loadFfmpeg(onProgress);
  const perLoop = frameCount(opts);
  const total = perLoop * (opts.loops ?? 1);

  for (let i = 0; i < total; i++) {
    // JPEG, not PNG: every frame sits in the wasm filesystem until the encode
    // runs, and at 2K a PNG sequence is gigabytes. The output is lossy H.264
    // either way, so the intermediate does not need to be lossless.
    const bytes = dataUrlToBytes(
      engine.captureLoopFrame(opts.size, i / perLoop, opts.hud, "image/jpeg", 0.94),
    );
    await ffmpeg.writeFile(`f${String(i).padStart(4, "0")}.jpg`, bytes);
    onProgress?.("rendering", i + 1, total);
    await tick();
  }

  onProgress?.("encoding", 0, 1);
  await ffmpeg.exec([
    "-framerate",
    String(opts.fps),
    "-i",
    "f%04d.jpg",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    // yuv420p and even dimensions are what makes the file play in Safari,
    // QuickTime and every social embed rather than only in a desktop player
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-movflags",
    "+faststart",
    "out.mp4",
  ]);

  const data = (await ffmpeg.readFile("out.mp4")) as Uint8Array;
  download(new Blob([toBlobPart(data)], { type: "video/mp4" }), `${name}.mp4`);

  // free the virtual FS so repeated exports do not grow memory without bound
  for (let i = 0; i < total; i++) {
    await ffmpeg.deleteFile(`f${String(i).padStart(4, "0")}.jpg`).catch(() => {});
  }
  await ffmpeg.deleteFile("out.mp4").catch(() => {});
}

// ── live MP4, with sound ────────────────────────────────────────────────────

/**
 * Record the live canvas and its audio in real time.
 *
 * Sound only exists as it plays, so unlike the loop exports this can't be
 * rendered frame by frame: it records the canvas exactly as it animates,
 * reacting to the music, for `seconds`. Browsers that can record MP4 directly
 * (Safari, recent Chrome) hand back the file as is; otherwise it records WebM
 * and the same ffmpeg.wasm encoder turns it into H.264 + AAC.
 */
export async function recordLiveMp4(
  canvas: HTMLCanvasElement,
  audio: MediaStream,
  opts: { fps: number; seconds: number },
  name: string,
  onProgress?: Progress,
) {
  const video = canvas.captureStream(opts.fps);
  const stream = new MediaStream([...video.getVideoTracks(), ...audio.getAudioTracks()]);
  const pick = (types: string[]) => types.find((t) => MediaRecorder.isTypeSupported(t));
  const mp4 = pick(['video/mp4;codecs="avc1.640028,mp4a.40.2"', "video/mp4"]);
  const type = mp4 ?? pick(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
  if (!type) throw new Error("This browser can't record video.");

  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192e3 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const check = () => {
      const s = (performance.now() - t0) / 1000;
      onProgress?.("recording", Math.min(opts.seconds, Math.floor(s)), opts.seconds);
      if (s >= opts.seconds) done();
      else setTimeout(check, 200);
    };
    check();
  });
  rec.stop();
  await stopped;
  video.getTracks().forEach((t) => t.stop());

  let out = new Blob(chunks, { type: "video/mp4" });
  if (!mp4) {
    const ffmpeg = await loadFfmpeg(onProgress);
    onProgress?.("encoding", 0, 1);
    await ffmpeg.writeFile("live.webm", new Uint8Array(await new Blob(chunks).arrayBuffer()));
    await ffmpeg.exec([
      "-i", "live.webm",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "live.mp4",
    ]);
    out = new Blob([toBlobPart((await ffmpeg.readFile("live.mp4")) as Uint8Array)], { type: "video/mp4" });
    await ffmpeg.deleteFile("live.webm").catch(() => {});
    await ffmpeg.deleteFile("live.mp4").catch(() => {});
  }
  download(out, `${name}.mp4`);
}
