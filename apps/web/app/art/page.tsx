import { FormStill } from "@/components/FormStill";

export const metadata = { title: "Cubic Symmetry Engine — art" };

const ARTICLE = "https://hidden-phenomena.com/articles/cubic";
const TWEET = "https://x.com/VitalikButerin/status/2081776660941029636";

/**
 * One line per archetype, describing what the equation actually does to build
 * it. Grouped by discriminant class exactly as `archetypeOf` groups them.
 */
const FORMS: { cls: string; note: string; items: [string, string][] }[] = [
  {
    cls: "Separated",
    note: "Δ > 0 — three distinct real roots, so the bodies sit apart on the real axis and the composition stays legible and ordered.",
    items: [
      [
        "Grid",
        "A field of columns on a plane, each raised by the combined pull of all three roots at that point — the heightfield is literally the root field.",
      ],
      [
        "Lattice",
        "A wireframe cube whose every node drifts toward the nearest root, so the cell structure warps around where the solutions fall.",
      ],
      [
        "Tessellation",
        "A hexagonal tiling extruded by the same root field, viewed at an angle so the three peaks read as three separate solutions.",
      ],
      [
        "Tower",
        "One stacked column per root, placed at that root's coordinates in the complex plane and twisted as it rises by |c|.",
      ],
      [
        "Strata",
        "Horizontal beds of varying thickness, eroded away wherever a root passes through them — the roots are cut out rather than drawn in.",
      ],
      [
        "Labyrinth",
        "A maze carved into a plane, its turn order set by the p:q balance and the phase. Cells inside a root's field are never carved, so the corridors route around all three.",
      ],
      [
        "Fold",
        "A single pleated sheet of alternating mountain and valley creases, the crease count from p:q and the fold angle from |c|. The pleating flattens where the root field is strongest.",
      ],
      [
        "Prism",
        "Hexagonal columns grown outward from each root and packed base to base, their length taken from that root's modulus and their splay from the discriminant.",
      ],
    ],
  },
  {
    cls: "Fractured",
    note: "Δ < 0 — one real root and a complex conjugate pair. The pair is mirror-symmetric about the real axis, and every form here is built around that broken symmetry.",
    items: [
      [
        "Knot",
        "Three torus knots whose winding numbers come from the phase and the root index, sized by each root's modulus.",
      ],
      [
        "Exploded",
        "A solid fragmented along its own surface normals, the source shape chosen by arg(A) and stretched by how far the conjugate pair sits off the real axis.",
      ],
      [
        "Cascade",
        "Three particle streams falling from the roots, each deflected by all three as it drops, so the columns braid.",
      ],
      [
        "Spiral",
        "Three helices, one per root, with turn count from the p:q balance and pitch from the curvature term.",
      ],
      [
        "Shell",
        "Nested shells, each drifting toward its corresponding root, so the layers decentre by exactly the root spread.",
      ],
      [
        "Orbital",
        "Three elliptical orbits whose semi-major axis is a root's modulus and whose eccentricity comes from p:q, inclined a third of a turn apart by the phase.",
      ],
      [
        "Weave",
        "Interlaced bands on two axes, lifted alternately and then pushed out of plane by the root field beneath them.",
      ],
      [
        "Rift",
        "A stack of plates split along the axis running between two roots, the halves sliding past each other by the magnitude of the discriminant.",
      ],
      [
        "Bloom",
        "Three petal whorls, one per root, each opening wider the further its root sits from the origin — threefold by construction, not decoration.",
      ],
      [
        "Arbor",
        "The one recursive form: a trunk splitting into three primary limbs, each aimed at a root, every generation a fixed fraction of its parent taken from p:q.",
      ],
    ],
  },
  {
    cls: "Merged",
    note: "Δ ≈ 0 — a repeated root. The rarest tier, and the only one that cannot be reached by chance: floating point never lands exactly on zero, so these are built root-first, choosing the roots and expanding back into coefficients. It is also the one family where |Δ| is not just small but exactly zero, so nothing here can be driven by the discriminant — these four are shaped by |c| and p:q instead.",
    items: [
      [
        "Void",
        "A cage of latitude rings with rings omitted wherever a root sits, so the roots are defined by absence rather than mass.",
      ],
      [
        "Radial",
        "Concentric rings of spokes whose lengths are the root field sampled around the circle, each ring rotated by the phase.",
      ],
      [
        "Vessel",
        "The only solid of revolution in the set: the three root moduli read as radii up the axis, so a triple root turns the whole profile symmetric and a double root leaves one shoulder proud.",
      ],
      [
        "Aperture",
        "Three stacked stages of overlapping iris blades, closing onto the point the roots have collapsed to. The opening comes from |c|, since |Δ| is zero everywhere in this family.",
      ],
    ],
  },
];

export default function ArtPage() {
  return (
    <div className="doc">
      <h2>
        The Art<br/>
        <span className="aka">AKA</span><br/>
        The Phenotypes

      </h2>

      <section className="essay">
        <p>
          I grew up on dial-up bulletin boards, and the 3D demoscene. Somewhere along the way, I lost myself in door games, and awesome ANSI/ASCII art in file_id.diz files. 
          Deeply immersed in door games, at some point my enthrallment with everything being drawn in character grids turned into a kind of obsession with box glyphs, shade blocks, and basic punctuation outlining dragons and digital graffiti.
          The constraint of fixed cells, sixteen colors, and the imagination it forced was the whole appeal. ANSI art is the last widely used medium where the atom of the
          image is a letter. This collection of <strong>Forms</strong> renders real 3D geometry and then tosses the pixels, keeping only which character best matches the light that lands in each cell. Nothing is filtered to look retro. The grid is the medium.
        </p>
        <p>
          The second part of this generator is an ode to the non-negotiable nature of mathematics. 
          A cubic has three roots; changing the constant shifts the roots without changing how many there are. Solving it will always yield the same answer. That is a rare quality in most generative art. It usually leans on noise; on a random seed dressed up as intent. Here the seed only chooses <em>which</em> equation. Everything after that is forced: the discriminant decides whether the form separates, fractures or merges; the roots decide where the bodies go; the leftover freedom in choosing a cube root becomes a threefold phase. 
          A single coefficient change changes the whole piece, for a reason you can check. Mathematics is always brutally honest.
        </p>
        <p>
          This is why the idea of it living on a blockchain, is so appealing to me; it's not just decoration, but it can be if you want it to be. 
          The curve that signs every Ethereum transaction, secp256k1, is{" "} <em>y² = x³ + 7</em>, which is a cubic. It is usable as a cryptographic curve precisely when its discriminant is non-zero, and that discriminant is{" "} <code>−16(4a³ + 27b²)</code>: exactly sixteen times the{" "} <code>Δ = −4p³ − 27q²</code> this collection is built on. Run secp256k1&rsquo;s cubic through this engine and it comes out Δ = −1323,{" "}
          <a href="#fractured">Fractured</a>, one real root and a conjugate pair. The rarest tier here,{" "}
          <a href="#merged">Merged</a>, is the case Δ = 0 — a repeated root, a singular curve, the one shape cryptography cannot use.
        </p>
        <p>  
          I found the derivation through{" "}
          <a href={TWEET} target="_blank" rel="noreferrer noopener">
            a post by Vitalik Buterin
          </a>{" "}
          pointing at{" "}
          <a href={ARTICLE} target="_blank" rel="noreferrer noopener">
            the article
          </a>
          , which felt like the a loop I didn't know I wanted or needed to close: the same algebra that secures the chain these live on, drawn in the character set I grew up reading.
        </p>
      </section>

      <div className="callout">
        <div className="mono-label" style={{ marginBottom: 8 }}>
          secp256k1, through this engine
        </div>
        <pre>{`
  y² = x³ + 7                       Ethereum's secp256k1 signing curve
  x³ + 0x + 7                       its cubic, with p = 0, q = 7

  Δ  = −4p³ − 27q²  = −1323         non-zero, so the curve is usable
  EC = −16(4a³ + 27b²) = −21168     = 16 × Δ

class: Fractured   one real root, one conjugate pair`}</pre>
      </div>

      <h3 style={{ marginTop: 40 }}>The twenty-two forms</h3>
      <p className="muted" style={{ marginBottom: 22 }}>
        The discriminant&rsquo;s sign selects a family; the coefficients choose within it
        and then drive every parameter inside the form. Every example below is a real
        Form from the collection, rendered by the same engine and forced into one shared
        palette so the difference between them reads as shape rather than colour.
      </p>

      {FORMS.map((group) => (
        <section key={group.cls} id={group.cls.toLowerCase()} className="form-group">
          <h4>
            {group.cls}
            <span className="muted" style={{ marginLeft: 10, textTransform: "none" }}>
              {group.items.length} forms
            </span>
          </h4>
          <p className="muted">{group.note}</p>
          <dl className="forms">
            {group.items.map(([name, how]) => (
              <div key={name}>
                <FormStill name={name} cls={group.cls} />
                <dt>{name}</dt>
                <dd>{how}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
