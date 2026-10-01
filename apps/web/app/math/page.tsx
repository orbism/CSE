import Link from "next/link";
import { ARCHETYPES } from "@cse/core";
import { MathDemo, type DemoSample } from "@/components/MathDemo";
import { ProvenanceCheck } from "@/components/ProvenanceCheck";

/**
 * Three solutions carried through every figure on the page.
 *
 * The same three throughout on purpose: you watch one set of Forms change as
 * each section adds its parameter, rather than meeting new examples each time.
 * They start in different discriminant classes so the sliders visibly do
 * different things to each.
 */
const TRIO: DemoSample[] = [
  { label: "Separated", cubic: { a: -5.44, b: -5.47, c: 10.91 }, branch: 0 },
  { label: "Fractured", cubic: { a: 2.1, b: 4.8, c: 7.4 }, branch: 1 },
  { label: "Near-degenerate", cubic: { a: -3, b: 3, c: -1 }, branch: 2 },
];

/** Root-first versions of the same three, for the Energy/Feedback figure. */
const TRIO_ROOTS: DemoSample[] = [
  { label: "Separated", roots: [-2.2, 0.4, 2.6], branch: 0 },
  { label: "Fractured", roots: [-1.1, 1.1, 2.4], branch: 1 },
  { label: "Near-degenerate", roots: [1, 1.05, -2], branch: 2 },
];

export const metadata = { title: "Cubic Symmetry Engine · math" };

const ARTICLE = "https://hidden-phenomena.com/articles/cubic";
const TWEET = "https://x.com/VitalikButerin/status/2081776660941029636";

/** Grouped exactly as `archetypeOf` groups them, so the page cannot drift. */
const FAMILIES: { cls: string; share: string; rule: string; forms: string[] }[] = [
  {
    cls: "Separated",
    share: "Δ > 0 · ~36%",
    rule: "three distinct real roots, bodies sit apart on the real axis",
    forms: ["Grid", "Lattice", "Tessellation", "Tower", "Strata", "Labyrinth", "Fold", "Prism"],
  },
  {
    cls: "Fractured",
    share: "Δ < 0 · ~55%",
    rule: "one real root and a complex conjugate pair, the form breaks open",
    forms: [
      "Knot",
      "Exploded",
      "Cascade",
      "Spiral",
      "Shell",
      "Orbital",
      "Weave",
      "Rift",
      "Bloom",
      "Arbor",
    ],
  },
  {
    cls: "Merged",
    share: "Δ ≈ 0 · ~9%",
    rule: "a repeated root, bodies collapse into each other",
    forms: ["Void", "Radial", "Vessel", "Aperture"],
  },
];

const DRIVERS = [
  ["a", "global scale and framing", "|a| sets how tight the camera fits"],
  ["b", "glyph grid density", "80 to 200 cells a side, |b| sets how fine"],
  ["c", "curvature", "bends, twists and opens primitives, also picks the archetype quartile"],
  ["a/3", "world translation", "the depression's own shift, relative to the Form's size"],
  ["Δ", "fracture magnitude", "log-compressed, sets how hard the discriminant operator pushes things apart"],
  ["arg(A)", "palette", "the resolvent's argument picks the ANSI ramp"],
  ["branch", "phase", "which cube root of A³ gets used, turns the ω-triad a third"],
  ["roots", "body placement", "α, β, γ as points in ℂ, normalised to the unit disc"],
  ["max |root|", "energy", "how far out the roots sit, the scale the unit-disc normalisation throws away"],
  ["min |αᵢ−αⱼ|", "feedback", "how close the nearest two roots are, sets how hard the render feeds back on itself"],
];

export default function MathPage() {
  return (
    <div className="doc">
      <h2>
        How a cubic becomes a shape
        <br />
        <span className="aka">AKA</span>
        <br />
        How a genotype is constructed
      </h2>

      <p className="lede">
        No textures, no model files. Every vertex gets computed at load from the{" "}
        <strong>Form&rsquo;s</strong> seed. Here&rsquo;s the whole chain, and where the math
        stops and I start. Heads up, it&rsquo;s pretty technical. Not your thing? Skip
        straight to the <Link href="/lab">lab</Link> and break stuff.
      </p>

      <section>
        <h3>1 · The solution</h3>
        <p>
          Start with <code>x³ + ax² + bx + c</code>. Sub in <code>y = x + a/3</code>, the
          square term drops out and you get the <em>depressed cubic</em>{" "}
          <code>y³ + py + q</code>:
        </p>
        <pre>{`p = b − a²/3
q = 2a³/27 − ab/3 + c`}</pre>
        <p>
          Everything hangs on <code>D = (α−β)(β−γ)(γ−α)</code>. Swap two roots and it flips
          sign, so it&rsquo;s not symmetric. Square it though and it is, and that&rsquo;s the
          discriminant:
        </p>
        <pre>{`Δ = D² = −4p³ − 27q²`}</pre>
        <p>
          Take <code>ω = (−1 + i√3)/2</code>, the primitive cube root of unity. The Lagrange
          resolvent (thanks Joseph) <code>A = α + ωβ + ω²γ</code> has a cube you can write
          purely in <code>p</code>, <code>q</code> and <code>D</code>, and the roots fall out
          of that:
        </p>
        <pre>{`A³ = −27q/2 − (3i√3/2)·D

α = A/3 − p/A
β = ω²A/3 − ωp/A
γ = ωA/3 − ω²p/A`}</pre>

        <p className="muted">
          Mess with the coefficients and watch the whole chain follow: depressed form,
          discriminant, class, the Form itself. Every figure on this page is the real
          pipeline running live.
        </p>
        <MathDemo
          mode="coefficients"
          samples={TRIO}
          readouts={["depressed", "delta", "class"]}
          controls={[
            { key: "a", label: "a", min: -9, max: 9, step: 0.1, initial: -5.44,
              hint: "the square term the depression removes" },
            { key: "b", label: "b", min: -14, max: 14, step: 0.1, initial: -5.47,
              hint: "sets p, and the glyph density" },
            { key: "c", label: "c", min: -16, max: 16, step: 0.1, initial: 10.91,
              hint: "sets q, and the curvature" },
          ]}
        />
      </section>

      <section>
        <h3>2 · The choice that becomes the Phase</h3>
        <p>
          <code>A³</code> has three cube roots. Swap <code>A</code> for <code>ωA</code> and
          α → γ → β. Same <em>set</em> of roots, new labels. That leftover freedom, after
          you&rsquo;ve picked a square root and then a cube root, is the only real wiggle
          room in the whole solution, and it&rsquo;s what the <strong>Phase</strong> trait
          records. Each Form commits to one branch, which turns its ω-triad a third of a turn.
        </p>
        <p>
          Early on I tried getting phase from <code>arg(A)</code>. Turns out it&rsquo;s nearly
          constant for most real-coefficient samples, with floating point noise deciding the
          rest, so 98.6% of generations got the same value and came out identical. Oops.
        </p>
        <MathDemo
          mode="coefficients"
          samples={TRIO}
          readouts={["structure", "class"]}
          controls={[
            { key: "branch", label: "branch ω", min: 0, max: 2, step: 1, initial: 0,
              hint: "same roots, relabeled. the triad turns a third" },
          ]}
        />
      </section>

      <section>
        <h3>3 · From solution to Form</h3>
        <p>The sign of the discriminant picks a family:</p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Meaning</th>
              <th>Forms</th>
            </tr>
          </thead>
          <tbody>
            {FAMILIES.map((f) => (
              <tr key={f.cls}>
                <td>
                  <strong>{f.cls}</strong>
                  <div className="muted">{f.share}</div>
                </td>
                <td className="muted">{f.rule}</td>
                <td>{f.forms.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Family sizes just follow how often each class actually turns up in random real
          cubics, and if I split them evenly the Merged forms would each get a handful of
          Forms while a couple of Fractured ones ate the whole collection.
        </p>
        <p>
          The repeated-root share is the one number I set instead of measuring, because
          random real cubics basically never land on exactly Δ = 0 in floating point, so I
          inject that tier on purpose at 8% of supply, which is enough for all four Merged
          forms to show up in 512 and it&rsquo;s still the rarest tier by a mile.
        </p>

        <p>Inside a family, the coefficients drive everything:</p>
        <table className="doc-table">
          <tbody>
            {DRIVERS.map(([sym, what, how]) => (
              <tr key={sym}>
                <td>
                  <code>{sym}</code>
                </td>
                <td>{what}</td>
                <td className="muted">{how}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="muted">
          Same three solutions again. |c| bumps them between archetypes when it crosses a
          quartile boundary, |b| changes how fine the grid is, |a| moves the camera in or out.
        </p>
        <MathDemo
          mode="coefficients"
          samples={TRIO}
          readouts={["structure", "delta"]}
          controls={[
            { key: "a", label: "a · framing", min: -9, max: 9, step: 0.1, initial: -5.44 },
            { key: "b", label: "b · glyph density", min: -14, max: 14, step: 0.1, initial: -5.47 },
            { key: "c", label: "c · curvature and archetype", min: -16, max: 16, step: 0.1, initial: 10.91 },
          ]}
        />
      </section>

      <section>
        <h3>4 · Energy and Feedback</h3>
        <p>
          Two traits read numbers the rest of the derivation throws away.{" "}
          <strong>Energy</strong> is the biggest root modulus, which matters because the roots
          get normalised to the unit disc before they place anything, and that used to toss
          the absolute scale so two solutions with the same root triangle at totally
          different sizes drew the same. Energy hands that number back, a <em>Still</em> Form
          keeps its bodies tight and a <em>Violent</em> one flings them apart, and it&rsquo;s
          the one lever that reaches all twenty-two forms.
        </p>
        <p>
          <strong>Feedback</strong> is the gap between the two closest roots, which Δ
          can&rsquo;t see since it&rsquo;s a product and one tiny gap hides behind two big
          ones. It closes a loop that&rsquo;s normally open: ASCII renderers, mine included
          until I fixed it, only run one way, geometry in and characters out. Now last
          frame&rsquo;s grid feeds into the luminance this frame measures, so bright cells
          drag a trail behind them, quantised to the same twelve glyph levels so it bands
          instead of blurring. You mostly see it once things move.
        </p>
        <p className="muted">
          The sliders move the <em>roots</em>, not the traits, and Energy and Feedback just
          follow.
        </p>
        <MathDemo
          mode="roots"
          samples={TRIO_ROOTS}
          readouts={["bands", "delta"]}
          controls={[
            { key: "scale", label: "root scale → Energy", min: 0.15, max: 2.4, step: 0.05, initial: 1,
              hint: "how far out the roots sit" },
            { key: "separation", label: "pair separation → Feedback", min: 0, max: 2, step: 0.02, initial: 1,
              hint: "at 0 the closest two roots meet and Δ hits zero" },
          ]}
        />

        <table className="doc-table">
          <tbody>
            <tr>
              <td>
                <strong>Energy</strong>
              </td>
              <td className="muted">Still 18% · Charged 53% · Violent 30%</td>
            </tr>
            <tr>
              <td>
                <strong>Feedback</strong>
              </td>
              <td className="muted">None 52% · Echo 25% · Resonant 14% · Runaway 9%</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>5 · The engine</h3>
        <p>
          This is the engine part of the name. three.js handles the 3D and that&rsquo;s
          about it, everything after is my own pipeline. The scene renders offscreen at three
          by three samples per character cell, gets read back, and each cell&rsquo;s luminance
          picks one of twelve glyphs from <code>{" .:-=+*#%▒▓█"}</code> and one of five inks
          from the Form&rsquo;s ANSI palette, with the properly saturated cells getting the
          accent. Then it paints the grid onto a 2D canvas character by character, batched by
          ink so it stays fast, and the SVG export is that same grid as plain text rows, so
          the vector version is the actual characters and not a trace.
        </p>
        <p>
          Depth fog gives the ramp something to shade with or evenly lit surfaces flatten
          into one character, and exposure gets set per Form off a histogram of only the
          cells that actually have light in them, otherwise a sparse Orbital and a dense
          Tessellation get crushed in opposite directions.
        </p>
      </section>

      <section>
        <h3>6 · Sound</h3>
        <p>
          The <Link href="/lab">lab</Link> can listen. Share a tab&rsquo;s audio or pick a mic
          or line-in (BlackHole gets you system audio on a Mac) and it splits the signal into
          bass, mids and highs, each measured against a slowly fading peak so quiet and loud
          tracks both use the full range. The kick gets its own path, a steep band-pass
          around 60 Hz you can retune, measured against a floor that follows the level
          between kicks so a rolling sub doesn&rsquo;t hold the form open, and the spacing
          between kicks gives a BPM with a flywheel that keeps pumping through breakdowns.
        </p>
        <p>
          None of it touches the math or the genotype, it&rsquo;s a live layer on top. The kick
          pumps the size, mids push the glyph feedback, highs and kicks add spin, hi-hats tilt
          it and tear the raster, all eased so it moves instead of twitching, and exports
          come out clean.
        </p>
      </section>

      <section>
        <h3>7 · Uniqueness</h3>
        <p>
          Every seed is <code>SHA-256(master ‖ id ‖ nonce)</code> and generation tosses
          anything too close to an existing Form on two gates, one comparing the math as a
          weighted vector and one comparing a 496-bit hash of the actual render, re-rolling
          the nonce until it passes. It&rsquo;s all settled before the mint, minting only
          takes ids so nobody can sneak in their own coefficients, and the whole{" "}
          <code>id → seed</code> table is hashed into the contract with no setter, so you can
          check the art you saw is the art you got:
        </p>
        <ProvenanceCheck />
      </section>

      <section>
        <h3>8 · What the math doesn&rsquo;t decide</h3>
        <p>
          Being straight about this. The math decides the coefficients, the depressed form, Δ
          and its sign, the three roots as points in ℂ, the resolvent and its branch. Across
          the whole supply the worst residual <code>|p(root)|</code> is{" "}
          <strong>1.3 × 10⁻⁷</strong>, so yes, the roots actually solve their equations.
        </p>
        <p>
          The math does <em>not</em> decide that Δ &lt; 0 should look like a knot and not a
          tower. The {ARCHETYPES.length} archetypes are a vocabulary I wrote. The equation
          picks from it and drives every parameter inside, but the vocabulary is a design
          call, not a theorem. The primitives (torus knot, icosahedron, cone) are parametric
          generators from three.js, built at runtime, never loaded as assets.
        </p>
      </section>

      <section>
        <h3>Sources</h3>
        <ul className="links">
          <li>
            The derivation this is built on:{" "}
            <a href={ARTICLE} target="_blank" rel="noreferrer noopener">
              How to Solve Cubic and Quartic Equations II: Cubics
            </a>{" "}
            <span className="muted">· hidden-phenomena.com</span>
          </li>
          <li>
            The prompt for the whole thing:{" "}
            <a href={TWEET} target="_blank" rel="noreferrer noopener">
              a post by Vitalik Buterin
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
