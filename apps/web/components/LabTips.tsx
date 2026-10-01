"use client";

import { useEffect, useState } from "react";

/** Eight words or fewer each. Some are help, some are scene. */
const TIPS = [
  "Drag headers to rearrange the desk.",
  "Drag a window's corner to resize it.",
  "Two columns wide? Contents split in two.",
  "Tidy snaps everything back to the grid.",
  "Roll the dice for a random layout.",
  "Get weird escalates with every press.",
  "Keep a form, then breed with it.",
  "The genotype is the art. Copy it.",
  "Paste a genotype to summon its form.",
  "Feedback lets the glyphs sculpt the geometry.",
  "Drag the form itself to turn it.",
  "Share a tab's audio. Watch it pump.",
  "Lower kickHz to isolate the kick.",
  "Snap tightens the pump. Techno likes tight.",
  "Hi-hats wobble. Hi-hats glitch. Blame hi-hats.",
  "Advanced breaks the sound out into modules.",
  "Flash strobes. Mind your friends' eyes.",
  "BlackHole routes system audio on macOS.",
  "Every link carries its genotype. Share freely.",
  "Export an MP4. Loop it twice.",
  "GIFs loop seamlessly. Feedback included.",
  "Six colour schemes. Click the circle.",
  "Minimise the windows you never touch.",
  "Nothing here is mintable. Everything here is yours.",
  "No 64k limit. Please don't test it.",
  "Greetings to all sceners, lamers excluded.",
  "Coded in a basement, spiritually speaking.",
  "Now with 100% more raster tears.",
  "Tracker modules not included. Bring your own.",
  "Party version. The final never shipped.",
  "Copper bars were busy. We used glyphs.",
  "Crack intro sold separately.",
  "Best viewed on a CRT at 3am.",
  "Released at no party. Voted first anyway.",
  "Your GPU called. It says it's fine.",
  "Scrolltext unavailable. Please imagine one here.",
];

const EVERY_MS = 7000;

/** One tip at a time, centred in the lab bar, reshuffled every few seconds. */
export function LabTips() {
  // First paint is fixed so server and client agree; randomness starts after.
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setI((cur) => (cur + 1 + Math.floor(Math.random() * (TIPS.length - 1))) % TIPS.length),
      EVERY_MS,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <span className="lab-tip mono-label" key={i} aria-live="polite">
      {TIPS[i]}
    </span>
  );
}
