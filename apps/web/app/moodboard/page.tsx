import { Moodboard } from "@/components/Moodboard";

export const metadata = { title: "Cubic Symmetry Engine · moodboard" };

export default function MoodboardPage() {
  return (
    <>
      <div className="prose" style={{ padding: "24px 0 8px" }}>
        <h2 style={{ marginBottom: 10 }}>Moodboard</h2>
        <p style={{ fontSize: 14 }}>
          The range of the engine, live. Every tile is a Form running in the real renderer,
          feedback trail and all. Open one for the full viewer and to download it as a
          2000px PNG, a seamless GIF or an MP4.
        </p>
      </div>
      <Moodboard />
    </>
  );
}
