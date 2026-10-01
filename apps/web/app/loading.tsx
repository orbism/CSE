import { EDGE, SHADE, TRIAD, cube } from "@/lib/triad";

const MARKS = ["mark-c-fill", "mark-s-fill", "mark-e-fill"];

/**
 * Shown by Next while a section loads. The favicon's ω-triad, three cubes a
 * third of a turn apart, turning in the live scheme's colours.
 */
export default function Loading() {
  return (
    <div className="loader" role="status" aria-label="Loading">
      <svg viewBox="0 0 32 32" aria-hidden>
        <g className="loader-triad">
          <path className="loader-edge" d={EDGE} />
          {TRIAD.map(([x, y], i) => {
            const f = cube(x, y);
            return (
              <g key={i} className={MARKS[i]}>
                <path d={f.top} />
                <path d={f.left} />
                <path d={f.left} fill="#000" fillOpacity={SHADE.left} />
                <path d={f.right} />
                <path d={f.right} fill="#000" fillOpacity={SHADE.right} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
