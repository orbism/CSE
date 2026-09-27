import type { AnchorProjection, ProjectedAnchor } from "./renderer.js";

/** Below this the stage cannot hold a sentence per anchor; show tags only. */
export const COMPACT_BELOW = 560;
/** Minimum angular separation between two callouts, in radians. */
const MIN_ANGLE = 0.34;
/** More than this and the piece disappears behind its own annotations. */
const MAX_CALLOUTS = 6;
/** Anything fainter than this has rotated too far back to read. */
const MIN_OPACITY = 0.06;

export interface Callout extends ProjectedAnchor {
  /** Label anchor point, out on the ring around the piece. */
  lx: number;
  ly: number;
  /** Elbow between the dot and the label, so the leader reads as one stroke. */
  ex: number;
  ey: number;
  side: -1 | 1;
  angle: number;
}

export interface Layout {
  callouts: Callout[];
  compact: boolean;
  size: number;
}

/**
 * Place the readout callouts around the piece.
 *
 * Shared by the on-screen HTML overlay and the canvas renderer used for
 * exports, so a downloaded still or loop is laid out identically to what was on
 * screen when it was requested. Two implementations would drift apart the first
 * time either was tweaked.
 */
export function layoutCallouts(projection: AnchorProjection, size: number): Layout {
  const { anchors, cx, cy, radius } = projection;
  const compact = size < COMPACT_BELOW;

  // ring just outside the silhouette, kept inside the frame
  const ring = Math.min(Math.max(radius * 1.04 + size * 0.03, size * 0.3), size * 0.44);

  const visible = anchors
    .filter((a) => a.opacity > MIN_OPACITY)
    // keep the ones facing the viewer when there are more than fit
    .sort((a, b) => b.opacity - a.opacity)
    .slice(0, MAX_CALLOUTS)
    .map((a) => ({ ...a, angle: Math.atan2(a.y - cy, a.x - cx) }))
    .sort((a, b) => a.angle - b.angle);

  // Spread callouts that would otherwise sit on top of each other. Two passes:
  // pushing only forward drove a whole cluster the same way and piled every
  // label into one corner of the frame.
  for (let i = 1; i < visible.length; i++) {
    if (visible[i].angle - visible[i - 1].angle < MIN_ANGLE) {
      visible[i].angle = visible[i - 1].angle + MIN_ANGLE;
    }
  }
  for (let i = visible.length - 2; i >= 0; i--) {
    if (visible[i + 1].angle - visible[i].angle < MIN_ANGLE) {
      visible[i].angle = visible[i + 1].angle - MIN_ANGLE;
    }
  }

  const boxH = compact ? size * 0.045 : size * 0.085;
  const inset = size * 0.11;

  const callouts: Callout[] = visible.map((a) => {
    const ux = Math.cos(a.angle);
    const uy = Math.sin(a.angle);
    return {
      ...a,
      ex: cx + ux * ring * 0.82,
      ey: cy + uy * ring * 0.82,
      lx: Math.max(inset, Math.min(size - inset, cx + ux * ring)),
      ly: Math.max(boxH / 2 + 4, Math.min(size - boxH / 2 - 4, cy + uy * ring)),
      side: (ux < 0 ? -1 : 1) as -1 | 1,
    };
  });

  return { callouts, compact, size };
}
