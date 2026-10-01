/**
 * The ω-triad mark (favicon and loader): three small isometric cubes at a
 * third of a turn apart — a cubic's three roots — on a 32x32 grid.
 */

/** How far each cube sits from the centre, and the half-width of its hexagon. */
const SPREAD = 6.6;
export const CUBE_R = 5.4;

/** Cube centres: top, lower right, lower left, a third of a turn apart around (16, 16). */
export const TRIAD: [number, number][] = [0, 1, 2].map((k) => {
  const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
  return [16 + SPREAD * Math.cos(a), 16 + SPREAD * Math.sin(a)];
});

/** The triangle joining them, drawn behind the cubes. */
export const EDGE = `M${TRIAD.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;

/** SVG paths for one isometric cube: lit top, mid left, dark right. */
export function cube(x: number, y: number, r = CUBE_R) {
  const w = r * 0.866;
  const p = (pts: number[][]) => `M${pts.map(([a, b]) => `${+a.toFixed(2)} ${+b.toFixed(2)}`).join("L")}Z`;
  return {
    top: p([[x, y - r], [x + w, y - r / 2], [x, y], [x - w, y - r / 2]]),
    left: p([[x - w, y - r / 2], [x, y], [x, y + r], [x - w, y + r / 2]]),
    right: p([[x, y], [x + w, y - r / 2], [x + w, y + r / 2], [x, y + r]]),
  };
}

/** Shading per face, as black over the cube's colour. */
export const SHADE = { top: 0, left: 0.28, right: 0.5 };

/** The whole mark as an SVG string, for the favicon. */
export function triadSvg(c: { bg: string; line: string; marks: [string, string, string] }) {
  const cubes = TRIAD.map(([x, y], i) => {
    const f = cube(x, y);
    return (
      `<path d="${f.top}" fill="${c.marks[i]}"/>` +
      `<path d="${f.left}" fill="${c.marks[i]}"/><path d="${f.left}" fill="#000" fill-opacity="${SHADE.left}"/>` +
      `<path d="${f.right}" fill="${c.marks[i]}"/><path d="${f.right}" fill="#000" fill-opacity="${SHADE.right}"/>`
    );
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="6" fill="${c.bg}"/>` +
    `<rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="${c.line}" stroke-width="1.5"/>` +
    `<path d="${EDGE}" fill="none" stroke="${c.line}" stroke-width="1.2"/>` +
    cubes +
    `</svg>`
  );
}
