import { AllowlistForm } from "@/components/AllowlistForm";

export const metadata = { title: "Cubic Symmetry Engine · allowlist" };

export default function AllowlistPage() {
  return (
    <div className="doc allowlist-page">
      <h2>Allowlist</h2>
      <AllowlistForm />
    </div>
  );
}
