/**
 * ANSI-flavoured palettes. Each is a background plus a luminance ramp of five
 * ink colours; the glyph pass picks an ink by brightness band, so a palette
 * reads as a coherent terminal phosphor rather than an arbitrary gradient.
 */

export interface Palette {
  name: string;
  bg: string;
  /** Dim -> bright. Index chosen by luminance band in the ASCII pass. */
  ink: [string, string, string, string, string];
  /** Used for the accent glyphs that mark root positions. */
  accent: string;
}

export const PALETTES: readonly Palette[] = [
  {
    name: "PHOSPHOR",
    bg: "#050806",
    ink: ["#0d3a1e", "#12622f", "#1c9c46", "#33d967", "#a8ffbe"],
    accent: "#e8fff0",
  },
  {
    name: "AMBER",
    bg: "#0a0603",
    ink: ["#3d2306", "#6b3d08", "#a86610", "#e0952a", "#ffd694"],
    accent: "#fff3d6",
  },
  {
    name: "VT-CYAN",
    bg: "#03080a",
    ink: ["#083b45", "#0c6373", "#12a0b8", "#2ad6ef", "#a6f4ff",
    ],
    accent: "#e6feff",
  },
  {
    name: "MAGENTA-BURN",
    bg: "#0a030a",
    ink: ["#3d0a37", "#6b1160", "#a81c95", "#e034c8", "#ffa8ef"],
    accent: "#ffe0fa",
  },
  {
    name: "IRON",
    bg: "#060607",
    ink: ["#232529", "#3c4046", "#5f656e", "#949cab", "#dfe6f0"],
    accent: "#ffffff",
  },
  {
    name: "OXBLOOD",
    bg: "#0a0404",
    ink: ["#3d0d0d", "#6b1616", "#a82424", "#e04040", "#ff9e9e"],
    accent: "#ffe0e0",
  },
  {
    name: "ULTRAVIOLET",
    bg: "#04030c",
    ink: ["#1b1350", "#2c1f86", "#4832c4", "#7059f0", "#b7a8ff"],
    accent: "#e6e0ff",
  },
  {
    name: "BONE",
    bg: "#0b0a08",
    ink: ["#2e2a22", "#4d473a", "#7a7160", "#b3a892", "#f2ead6"],
    accent: "#fffdf5",
  },
  {
    name: "SIGNAL",
    bg: "#050505",
    ink: ["#2c3d0a", "#4f6b11", "#84a81c", "#bce033", "#e8ffa8"],
    accent: "#f7ffdb",
  },
];

export function paletteByName(name: string): Palette {
  const found = PALETTES.find((p) => p.name === name);
  if (!found) throw new Error(`unknown palette: ${name}`);
  return found;
}
