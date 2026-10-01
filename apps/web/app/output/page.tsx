import { Suspense } from "react";
import { Gallery } from "@/components/Gallery";
import { IS_DEMO } from "@/lib/config";

export const metadata = { title: "Cubic Symmetry Engine · output" };

export default function OutputPage() {
  if (IS_DEMO) {
    return (
      <div className="prose closed-note">
        <h2>Output</h2>
        <p className="mono-label">closed till post mint</p>
        <p>Nothing out yet. Every Form lands here once it&rsquo;s minted.</p>
      </div>
    );
  }

  return (
    <>
      <div className="prose" style={{ padding: "24px 0 8px" }}>
        <h2 style={{ marginBottom: 10 }}>Output</h2>
        <p style={{ fontSize: 14 }}>
          All 512 Forms. Filter by any of the eight trait axes, or paste a wallet address
          to see only what it holds. Open one for the live render, the full solution, and
          downloads.
        </p>
      </div>

      {/* Gallery reads ?wallet= via useSearchParams, which opts the route out of
          static prerendering unless it sits behind a boundary. */}
      <Suspense fallback={<div className="empty">loading…</div>}>
        <Gallery />
      </Suspense>
    </>
  );
}
