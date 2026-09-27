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

export const metadata = { title: "Cubic Symmetry Engine — math" };

const ARTICLE = "https://hidden-phenomena.com/articles/cubic";
const TWEET = "https://x.com/VitalikButerin/status/2081776660941029636";

/** Grouped exactly as `archetypeOf` groups them, so the page cannot drift. */
const FAMILIES: { cls: string; share: string; rule: string; forms: string[] }[] = [
  {
    cls: "Separated",
    share: "Δ > 0 · ~36%",
    rule: "three distinct real roots — bodies sit apart on the real axis",
    forms: ["Grid", "Lattice", "Tessellation", "Tower", "Strata", "Labyrinth", "Fold", "Prism"],
  },
  {
    cls: "Fractured",
    share: "Δ < 0 · ~55%",
    rule: "one real root and a complex conjugate pair — the form breaks open",
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
    rule: "a repeated root — bodies collapse into one another",
    forms: ["Void", "Radial", "Vessel", "Aperture"],
  },
];

const DRIVERS = [
  ["a", "global scale and framing", "|a| decides how tightly the camera fits the Form"],
  ["b", "glyph-grid density", "80–200 cells per side, so |b| sets how fine the character grid is"],
  ["c", "curvature", "bends, twists and opens primitives; also picks the archetype quartile"],
  ["a/3", "world translation", "the depression's own shift, applied relative to the Form's size"],
  ["Δ", "fracture magnitude", "log-compressed, drives how far apart the discriminant operator pushes"],
  ["arg(A)", "palette", "the resolvent's argument selects the ANSI ramp"],
  ["branch", "phase", "which cube root of A³ is adopted — rotates the ω-triad by a third of a turn"],
  ["roots", "body placement", "α, β, γ as points in ℂ, normalised to the unit disc"],
  [
    "max |root|",
    "energy",
    "how far the roots sit from the origin — the scale the unit-disc normalisation throws away",
  ],
  [
    "min |αᵢ−αⱼ|",
    "feedback",
    "how close the nearest pair of roots is; drives how strongly the render feeds back on itself",
  ],
];

export default function MathPage() {
  return (
    <div className="doc">
      <h2>
        How a cubic becomes a shape <br/>
        <span className="aka">AKA</span><br/>
        How a genotype is constructed

      </h2>

      <p className="lede">
        There are no texture or model files. Every vertex is computed at load time from the <strong>Form&rsquo;s</strong> seed. Following is a breakdown of the whole chain, and an account of where the mathematics stops and the design begins.
      </p>

      <section>
        <h3>1 · The solution</h3>
        <p>
          First: <code>x³ + ax² + bx + c</code>. Substituting <code>y = x + a/3</code>{" "}
          removes the square term and gives the <em>depressed cubic</em>{" "}
          <code>y³ + py + q</code>, with:
        </p>
        <pre>{`p = b − a²/3
q = 2a³/27 − ab/3 + c`}</pre>
        <p>
          The object the derivation turns on is{" "}
          <code>D = (α−β)(β−γ)(γ−α)</code>. The sign flips when the roots are swapped, so it is not symmetric - but its square is, and equals the discriminant:
        </p>
        <pre>{`Δ = D² = −4p³ − 27q²`}</pre>
        <p>
          With <code>ω = (−1 + i√3)/2</code>, the primitive cube root of unity, the Lagrange 
          resolvent (thanks Joseph!) <code>A = α + ωβ + ω²γ</code> has a cube expressible entirely in{" "}
          <code>p</code>, <code>q</code> and <code>D</code>, and that gives us the roots:
        </p>
        <pre>{`A³ = −27q/2 − (3i√3/2)·D

α = A/3 − p/A
β = ω²A/3 − ωp/A
γ = ωA/3 − ω²p/A`}</pre>

        <p className="muted">
          Below, you can change the coefficients and watch the whole chain follow; the depressed form, the
          discriminant, the class, and the Form itself. Every figure on this page runs
          on a live pipeline, so they are live examples.
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
          <code>A³</code> has three cube roots. Replacing <code>A</code> with{" "} <code>ωA</code> sends α → γ → β: the same root <em>set</em>, relabeled. That residual freedom (what is left after you fix a square root and then a cube root) is the only genuine flexibility in the solution, and it is what the{" "} <strong>Phase</strong> trait records. Each Form commits to one branch, which rotates its ω-triad by a third of a turn.
        </p>
        <p>
          In an earlier version, I tried to derive phase from <code>arg(A)</code>. But it was nearly constant for most real-coefficient samples, with floating-point noise deciding the remainder, so 98.6% of generations got the same value and came out identical. Oops.
        </p>
        <MathDemo
          mode="coefficients"
          samples={TRIO}
          readouts={["structure", "class"]}
          controls={[
            { key: "branch", label: "branch ω", min: 0, max: 2, step: 1, initial: 0,
              hint: "the same roots, relabeled - the triad turns by a third" },
          ]}
        />
      </section>

      <section>
        <h3>3 · From solution to Form</h3>
        <p>The discriminant&rsquo;s sign selects a family of archetypes:</p>
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
        <p className="muted">
          Family sizes are proportional to how often each class occurs, which is a fact
          about random real cubics rather than a preference. Splitting all three evenly
          would leave the Merged forms sharing a handful of Forms each while a few
          Fractured archetypes covered most of the collection.
        </p>
        <p className="muted">
          The repeated-root share is the one class frequency the collection sets rather
          than measures. Random real cubics never land exactly on Δ = 0 in floating point,
          so that tier is injected on purpose — at 8% of the supply, enough that all four
          Merged forms exist in a 512-Form collection, and still the rarest tier by a wide
          margin.
        </p>

        <p>Within a family, the coefficients drive everything:</p>
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
          The same three solutions again. |c| moves them between archetypes as it crosses a
          quartile boundary, |b| changes how fine the character grid is, and |a| changes how
          tightly the camera sits.
        </p>
        <MathDemo
          mode="coefficients"
          samples={TRIO}
          readouts={["structure", "delta"]}
          controls={[
            { key: "a", label: "a — framing", min: -9, max: 9, step: 0.1, initial: -5.44 },
            { key: "b", label: "b — glyph density", min: -14, max: 14, step: 0.1, initial: -5.47 },
            { key: "c", label: "c — curvature and archetype", min: -16, max: 16, step: 0.1, initial: 10.91 },
          ]}
        />
      </section>

      <section>
        <h3>4 · Energy and Feedback</h3>
        <p>
          Two axes read quantities the rest of the derivation discards, which is why they
          are separate traits rather than restatements of Δ.
        </p>
        <p>
          <strong>Energy</strong> is the largest root modulus. Root positions are normalised
          to the unit disc before they place the bodies, and that normalisation throws the
          absolute scale away — two solutions with the same triangle of roots at wildly
          different magnitudes drew identically. Energy recovers exactly that discarded
          number and hands it back: every builder places its bodies from the root positions,
          so a <em>Still</em> Form draws its roots in tight and a <em>Violent</em> one flings
          them apart. It is the one lever that reaches all twenty-two forms.
        </p>
        <p>
          <strong>Feedback</strong> is the distance between the two nearest roots. The
          discriminant is <code>(α−β)(β−γ)(γ−α)</code> squared — a <em>product</em>, so one
          tiny separation hides behind two large ones, and a Form can have a perfectly
          ordinary |Δ| while two of its roots sit almost on top of each other. That is the
          case this picks out, and at the extreme it is the repeated-root tier itself.
        </p>
        <p>
          What it does is close a loop that is normally open. Every ASCII renderer, this one
          included until now, runs one way: geometry in, characters out, nothing downstream.
          Feedback carries the grid the pass produced last frame back into the luminance it
          measures this frame, so bright cells leave a decaying trail as the piece turns and
          the Form is partly drawn by its own afterimage. The trail is quantised to the same
          twelve glyph levels on the way round, so it terraces into bands rather than
          blurring. It is a motion trait: on the still it reads as a slight thickening, and
          it only really appears once the piece moves.
        </p>
        <p className="muted">
          These two sliders move the <em>roots</em>, not the traits — scale pushes them away
          from the origin, separation slides the nearest pair together. Energy and Feedback
          follow from that, which is exactly the claim above.
        </p>
        <MathDemo
          mode="roots"
          samples={TRIO_ROOTS}
          readouts={["bands", "delta"]}
          controls={[
            { key: "scale", label: "root scale → Energy", min: 0.15, max: 2.4, step: 0.05, initial: 1,
              hint: "how far the roots sit from the origin" },
            { key: "separation", label: "pair separation → Feedback", min: 0, max: 2, step: 0.02, initial: 1,
              hint: "at 0 the nearest two roots coincide and Δ goes to zero" },
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
        <h3>5 · Rendering</h3>
        <p>
          The scene is real 3D geometry in WebGL. It is then rendered into an offscreen
          target sized to the character grid, read back, and each cell replaced by a glyph
          chosen from its luminance —{" "}
          <code>{" .:-=+*#%▒▓█"}</code> — tinted from the Form&rsquo;s ANSI palette. Depth
          fog gives the ramp something to shade with; without it, evenly lit surfaces
          flatten into a single character.
        </p>
        <p>
          Exposure is computed per Form over the cells that actually carry light, not the
          whole frame. A sparse Orbital and a dense Tessellation would otherwise be crushed
          in opposite directions.
        </p>
      </section>

      <section>
        <h3>6 · Uniqueness</h3>
        <p>
          Each Form&rsquo;s seed is <code>SHA-256(master ‖ id ‖ nonce)</code>, so no two
          share one. Beyond that, generation rejects near-duplicates on two independent
          gates: a <strong>structural</strong> one comparing the derived mathematics as a
          weighted vector, and a <strong>perceptual</strong> one comparing a 496-bit hash of
          the rendered image (240 gradient bits, 256 occupancy bits). Failing either
          re-derives the Form under a bumped nonce. Both thresholds are calibrated from
          measured distributions rather than guessed.
        </p>
        <p>
          Because the collection is settled before the mint opens, choosing your id takes
          nothing away from that guarantee — every id already has verified-unique art.
        </p>
        <p>
          Two Forms cannot collide in the first place: a Form is a pure function of{" "}
          <code>(masterSeed, tokenId, nonce)</code>, and minting takes token ids and nothing
          else. There is no way to submit coefficients or a seed, so sharing a Form would
          mean sharing an id — which ERC-721 already forbids.
        </p>
        <p>
          What that alone does not show is that the art you were shown is the art the token
          is bound to, since the nonce lives off-chain. So the whole{" "}
          <code>id → seed</code> table is hashed and written into the contract at
          initialisation, with no setter, and the metadata pointer can be frozen. Both are
          checkable here:
        </p>
        <ProvenanceCheck />
      </section>

      <section>
        <h3>7 · What the maths does not decide</h3>
        <p>
          Worth stating plainly. The maths decides the coefficients, the depressed form, Δ
          and its sign, the three roots as points in ℂ, the resolvent and its branch. Across
          the whole supply the worst residual <code>|p(root)|</code> is{" "}
          <strong>1.3 × 10⁻⁷</strong> — the roots really do satisfy their equations.
        </p>
        <p>
          The maths does <em>not</em> decide that Δ&lt;0 should look like a knot rather than
          a tower. The {ARCHETYPES.length} archetypes are an authored vocabulary; the
          equation chooses among them and drives every parameter inside them, but the
          vocabulary itself is a design decision, not a theorem. The primitives being
          composed — torus knot, icosahedron, cone — are parametric generators from three.js,
          evaluated at runtime, never loaded as assets.
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
            <span className="muted">— hidden-phenomena.com</span>
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
