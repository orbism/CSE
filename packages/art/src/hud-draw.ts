import type { Palette } from "@cse/core";
import { GLYPH_FONT } from "./font.js";
import { type Layout, layoutCallouts } from "./hud-layout.js";
import type { AnchorProjection } from "./renderer.js";

/** Matches the site's per-term colouring so an export looks like the screen. */
function termColour(term: string, palette: Palette): string {
  if (term === "discriminant") return "#e0952a";
  if (term === "phase") return "#a08cff";
  return palette.accent;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw the readout onto the 2D canvas, for exports that keep it.
 *
 * The on-screen readout is HTML so it stays crisp and stays out of the pixels.
 * When a download is asked to keep it, it has to become pixels, so it is drawn
 * here from the same layout the overlay uses.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  projection: AnchorProjection,
  size: number,
  palette: Palette,
) {
  const { callouts, compact }: Layout = layoutCallouts(projection, size);
  if (callouts.length === 0) return;

  const tagSize = Math.max(9, size * (compact ? 0.03 : 0.022));
  const detailSize = Math.max(8, size * 0.017);
  const lineH = detailSize * 1.35;
  const maxWidth = size * 0.3;

  ctx.save();
  ctx.lineWidth = Math.max(1, size / 600);

  const margin = size * 0.015;

  for (const c of callouts) {
    const colour = termColour(c.term, palette);

    // Measure first, then clamp. On screen the label is a DOM box anchored to
    // an edge with a max-width, so the browser keeps it inside; on canvas there
    // is nothing to stop the text running off the frame, and it did.
    ctx.font = `${detailSize}px "${GLYPH_FONT}", monospace`;
    const lines = compact ? [] : wrap(ctx, c.detail, maxWidth);
    const detailW = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
    ctx.font = `${tagSize}px "${GLYPH_FONT}", monospace`;
    const textW = Math.max(detailW, ctx.measureText(c.label).width);

    const lx =
      c.side < 0
        ? Math.max(textW + margin, Math.min(size - margin, c.lx))
        : Math.min(size - textW - margin, Math.max(margin, c.lx));

    // leader: dot -> elbow -> label
    ctx.strokeStyle = colour;
    ctx.globalAlpha = c.opacity * 0.5;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.ex, c.ey);
    ctx.lineTo(lx, c.ly);
    ctx.stroke();

    // the point being annotated
    ctx.globalAlpha = c.opacity;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, size / 200), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = c.opacity * 0.45;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(4.5, size / 86), 0, Math.PI * 2);
    ctx.stroke();

    // label, growing away from the piece
    ctx.globalAlpha = c.opacity;
    ctx.textAlign = c.side < 0 ? "right" : "left";
    ctx.textBaseline = "alphabetic";

    const blockH = tagSize + (lines.length ? lines.length * lineH + 3 : 0);
    let y = c.ly - blockH / 2 + tagSize;

    ctx.font = `${tagSize}px "${GLYPH_FONT}", monospace`;
    ctx.fillStyle = colour;
    ctx.fillText(c.label, lx, y);
    y += 3;

    ctx.font = `${detailSize}px "${GLYPH_FONT}", monospace`;
    ctx.fillStyle = palette.ink[4];
    for (const line of lines) {
      y += lineH;
      ctx.fillText(line, lx, y);
    }

    // the rule under the text, in place of a bubble outline
    ctx.globalAlpha = c.opacity * 0.7;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(c.side < 0 ? lx - textW : lx, y + 4);
    ctx.lineTo(c.side < 0 ? lx : lx + textW, y + 4);
    ctx.stroke();
  }

  ctx.restore();
}
