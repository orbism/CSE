import Link from "next/link";
import { MintBox } from "@/components/MintBox";

const TWEET = "https://x.com/VitalikButerin/status/2081776660941029636";

export const metadata = { title: "Cubic Symmetry Engine · input" };

export default function InputPage() {
  return (
    <div className="split">
      <div className="prose">
        <h2 style={{ marginBottom: 12 }}>What this is</h2>
        <p>
          Every Form is one cubic equation, drawn as the thing it actually is. The three
          roots are the bodies, sitting where they land in the complex plane, the
          discriminant decides if they stay apart, fracture or merge, and the coefficients
          do the rest. Solving a cubic leaves exactly one real choice, which of three cube
          roots to take, and each Form commits to one.
        </p>
        <p>
          Then it gets rendered like it&rsquo;s 1994. Real 3D, pixels thrown out, every cell
          redrawn as a character, straight out of the 90s demo scene. If you remember BBSes,
          file_id.diz and a 64k intro melting your 486, you already know the look. Smells
          like a dial-up handshake.
        </p>
        <p>
          22 forms across 512 Forms. Solve again till one&rsquo;s yours, then mint that exact
          one. The whole thing started with{" "}
          <a href={TWEET} target="_blank" rel="noreferrer noopener">
            a post by Vitalik
          </a>{" "}
          about solving cubics.
        </p>
        <p>
          <Link href="/math">How it works →</Link>
        </p>
      </div>

      <MintBox />
    </div>
  );
}
