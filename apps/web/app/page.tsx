import { Lab } from "@/components/Lab";
import { LabIntro } from "@/components/LabIntro";

export const metadata = {
  title: "Cubic Symmetry Engine · lab",
  description:
    "An experimental form generator. Build a shape from an operator chain, let the glyph grid sculpt its own geometry, and export what you find.",
};

export default function LabPage() {
  return (
    <div className="doc lab-page">
      <h2>Lab</h2>
      <LabIntro />
      <Lab />
    </div>
  );
}
