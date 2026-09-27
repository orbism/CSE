import Link from "next/link";
import { MintBox } from "@/components/MintBox";

export const metadata = { title: "Cubic Symmetry Engine — input" };

export default function InputPage() {
  return (
    <div className="split">
      <div className="prose">
        <h2 style={{ marginBottom: 12 }}>What this is</h2>
        <p>
          Every Form in this collection is one cubic equation, drawn as the thing it
          actually is. The equation is depressed to <em>y³ + py + q</em>, solved through
          the Lagrange resolvent, and the answer becomes the composition: the three roots
          are the primary bodies, placed where they fall in the complex plane. The
          discriminant decides whether those bodies stay separated, fracture apart, or
          merge into one. The coefficients set scale, density and curvature, and the
          depression&rsquo;s own shift translates the entire world.
        </p>
        <p>
          The threefold structure is the point. Solving a cubic means choosing a square
          root and then a cube root, and that second choice leaves exactly three
          possibilities related by ω, the primitive cube root of unity. Each Form commits
          to one of them, which rotates its ω-triad by a third of a turn and relabels
          which root is α. Nothing here is decoration layered on top of a random seed —
          change the equation and the whole form changes with it. Rendered in WebGL, then
          resolved to a character grid.
        </p>
        <p style={{ color: "var(--ink-faint)", fontSize: 12 }}>
          Twenty-two structural archetypes across 512 Forms. Solve again until one is
          yours, then mint that exact piece — ids are chosen, not queued.{" "}
          <Link href="/math">How it works →</Link>
        </p>
      </div>

      <MintBox />
    </div>
  );
}
