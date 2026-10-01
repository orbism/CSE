import { FormStill } from "@/components/FormStill";

export const metadata = { title: "Cubic Symmetry Engine · art" };

const ARTICLE = "https://hidden-phenomena.com/articles/cubic";
const TWEET = "https://x.com/VitalikButerin/status/2081776660941029636";

/** Grouped by discriminant class exactly as `archetypeOf` groups them. */
const FORMS: { cls: string; note: string; names: string[] }[] = [
  {
    cls: "Separated",
    note: "Δ > 0 · three real roots",
    names: ["Grid", "Lattice", "Tessellation", "Tower", "Strata", "Labyrinth", "Fold", "Prism"],
  },
  {
    cls: "Fractured",
    note: "Δ < 0 · one real root, a conjugate pair",
    names: ["Knot", "Exploded", "Cascade", "Spiral", "Shell", "Orbital", "Weave", "Rift", "Bloom", "Arbor"],
  },
  {
    cls: "Merged",
    note: "Δ = 0 · a repeated root, the rarest tier",
    names: ["Void", "Radial", "Vessel", "Aperture"],
  },
];

export default function ArtPage() {
  return (
    <div className="doc">
      <h2>
        The Art
        <br />
        <span className="aka">AKA</span>
        <br />
        The Phenotypes
      </h2>

      <section className="essay">
        <p>
          I grew up on dial-up BBSes and the 3D demoscene. ANSI art in file_id.diz files,
          MODs and XMs looping off some tracker while a 64k intro melted your 486. So these
          Forms render real 3D and throw the pixels out, one character per cell. The grid
          is the medium.
        </p>
        <p>
          Every Form is one cubic equation. Three roots, always. The discriminant picks
          the family, the roots decide where everything goes. No noise pretending to be
          intent. And Ethereum signs with secp256k1, which is a cubic too. Found that
          through{" "}
          <a href={TWEET} target="_blank" rel="noreferrer noopener">
            Vitalik&rsquo;s post
          </a>{" "}
          on{" "}
          <a href={ARTICLE} target="_blank" rel="noreferrer noopener">
            this article
          </a>{" "}
          and it clicked. The same Δ that sorts every Form into a family is the thing that
          keeps that curve usable, and a Δ of zero is the one shape it can&rsquo;t touch.
          The math securing the chain these live on, drawn in the characters I grew up
          reading.
        </p>
      </section>

      <div className="callout">
        <pre>{`
  y² = x³ + 7                       Ethereum's secp256k1 curve
  x³ + 0x + 7                       a cubic, p = 0, q = 7

  Δ  = −4p³ − 27q²  = −1323         non-zero, so the curve works
  EC = −16(4a³ + 27b²) = −21168     = 16 × Δ

class: Fractured   one real root, one conjugate pair`}</pre>
      </div>

      {FORMS.map((group) => (
        <section key={group.cls} id={group.cls.toLowerCase()} className="form-group">
          <h4>
            {group.cls}
            <span className="muted" style={{ textTransform: "none" }}>
              {group.names.length}
            </span>
          </h4>
          <p className="muted">{group.note}</p>
          <div className="forms">
            {group.names.map((name) => (
              <figure key={name}>
                <FormStill name={name} cls={group.cls} />
                <figcaption>{name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
