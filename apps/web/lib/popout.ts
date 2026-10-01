/**
 * Pop the Lab's visualizer out into an always-on-top window.
 *
 *   window  Document Picture-in-Picture (Chrome, Edge, Brave — Chromium 116+).
 *           The live canvas element itself moves into the floating window, so
 *           everything keeps running: genome, audio input, pump, feedback. The
 *           engine and the audio analyser switch to that window's animation
 *           frames, because a background tab gets none. Drag in it to turn the
 *           form.
 *   video   Safari's fallback: the canvas is streamed into a hidden <video>
 *           and that goes picture-in-picture. Picture only — and it is drawn by
 *           the Lab tab, so the tab should stay visible (another app in front
 *           of the browser is fine; another tab in front of the Lab is not).
 *
 * Firefox has neither, so no button.
 */

export type PopKind = "window" | "video";

interface DocPip {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
}
type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

export function popKind(): PopKind | null {
  if ("documentPictureInPicture" in window) return "window";
  const v = document.createElement("video") as WebkitVideo;
  if (document.pictureInPictureEnabled || v.webkitSupportsPresentationMode?.("picture-in-picture")) return "video";
  return null;
}

export interface PopHandlers {
  /** The floating window is up; its frames should drive rendering. */
  onOpen?: (win: Window) => void;
  /** Square pixel size the canvas should now render at. */
  onResize?: (px: number) => void;
  onDrag?: (dx: number, dy: number) => void;
  onClose: () => void;
}

export interface Pop {
  close(): void;
}

/** Document PiP: must be called from a click. */
export async function popWindow(canvas: HTMLCanvasElement, h: PopHandlers): Promise<Pop> {
  const pip = (window as unknown as { documentPictureInPicture: DocPip }).documentPictureInPicture;
  const home = canvas.parentElement!;
  const edge = Math.min(420, Math.round(window.screen.width / 4));
  const win = await pip.requestWindow({ width: edge, height: edge });
  const doc = win.document;
  doc.title = "CSE · Lab";
  const style = doc.createElement("style");
  style.textContent =
    "html,body{margin:0;height:100%;background:#000;overflow:hidden}" +
    "body{display:grid;place-items:center;cursor:grab;touch-action:none}" +
    "body:active{cursor:grabbing}canvas{display:block;width:100vmin;height:100vmin}";
  doc.head.append(style);
  doc.body.append(canvas);

  const fit = () =>
    h.onResize?.(Math.round(Math.min(win.innerWidth, win.innerHeight) * (win.devicePixelRatio || 1)));
  win.addEventListener("resize", fit);

  let last: { x: number; y: number } | null = null;
  doc.body.addEventListener("pointerdown", (e) => {
    last = { x: e.clientX, y: e.clientY };
    doc.body.setPointerCapture(e.pointerId);
  });
  doc.body.addEventListener("pointermove", (e) => {
    if (!last) return;
    h.onDrag?.((e.clientX - last.x) * 0.01, (e.clientY - last.y) * 0.01);
    last = { x: e.clientX, y: e.clientY };
  });
  const release = () => (last = null);
  doc.body.addEventListener("pointerup", release);
  doc.body.addEventListener("pointercancel", release);

  win.addEventListener(
    "pagehide",
    () => {
      home.append(canvas);
      h.onClose();
    },
    { once: true },
  );

  h.onOpen?.(win);
  fit();
  return { close: () => win.close() };
}

/**
 * Video PiP, prepared ahead of the click: Safari only allows
 * picture-in-picture inside the click itself, and a video that has not
 * started yet is refused — so the stream is already playing when asked.
 */
export class VideoPop implements Pop {
  private video: WebkitVideo;

  constructor(canvas: HTMLCanvasElement, onClose: () => void) {
    const v = document.createElement("video") as WebkitVideo;
    v.muted = true;
    v.playsInline = true;
    v.srcObject = canvas.captureStream(30);
    // In the document but out of sight; display:none would be refused.
    v.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.append(v);
    v.play().catch(() => {});
    v.addEventListener("leavepictureinpicture", onClose);
    v.addEventListener("webkitpresentationmodechanged", () => {
      if (v.webkitPresentationMode === "inline") onClose();
    });
    this.video = v;
  }

  /** Call synchronously from a click. */
  open(): Promise<unknown> {
    const v = this.video;
    if (v.requestPictureInPicture) return v.requestPictureInPicture();
    v.webkitSetPresentationMode?.("picture-in-picture");
    return Promise.resolve();
  }

  close() {
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    else if (this.video.webkitPresentationMode === "picture-in-picture") this.video.webkitSetPresentationMode?.("inline");
  }

  dispose() {
    this.close();
    (this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    this.video.remove();
  }
}
