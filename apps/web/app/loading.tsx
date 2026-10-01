/**
 * Shown by Next while a section loads. The favicon's ω-triad — a cubic's three
 * roots, a third of a turn apart — turning in the live scheme's colours.
 */
export default function Loading() {
  return (
    <div className="loader" role="status" aria-label="Loading">
      <svg viewBox="0 0 32 32" aria-hidden>
        <g className="loader-triad">
          <path d="M16 8.5 22.5 19.75H9.5Z" />
          <circle cx="16" cy="8.5" r="3.4" className="mark-c-fill" />
          <circle cx="22.5" cy="19.75" r="3.4" className="mark-s-fill" />
          <circle cx="9.5" cy="19.75" r="3.4" className="mark-e-fill" />
        </g>
      </svg>
    </div>
  );
}
