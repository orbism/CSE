# CSEGlyph.woff2

The glyph font the pinned art bundle draws with: a subset of **JetBrains Mono
Regular** (SIL Open Font License 1.1, © The JetBrains Mono Project Authors; the
full license ships with the site at `apps/web/public/fonts/JetBrainsMono-OFL.txt`).
92,164 bytes → 5,416.

**Kept:** printable ASCII (U+0020–U+007E) plus every non-ASCII character in
`packages/art/src` and `packages/core/src` (the block ramp `▒▓█`, `αβγωΔ`,
`±²³·—₃−√`); original outlines and advance widths, so `CELL_ASPECT = 0.6` holds;
and the glyph names (`post` table v2).

**Dropped:** hinting; GSUB, GPOS and GDEF (one character per cell, so ligatures
never apply); gasp, DSIG, STAT, meta.

**Keep the glyph names.** Without them (`post` v3, the subsetter's default),
macOS rasterises the glyphs differently at whole-pixel sizes — tokens whose cell
height lands on an integer (9px, 10px) came out with antialiasing shifts of up
to 29/255. With them, every capture matches the full font byte for byte
(`pnpm --filter @cse/generator compare`, 62 tokens, all 22 forms, 600 and 900px).

Made with HarfBuzz's subsetter (`harfbuzzjs`), from the full font as TrueType:

```
flags      HB_SUBSET_FLAGS_GLYPH_NAMES | HB_SUBSET_FLAGS_NO_HINTING   (0x81)
features   none (layout feature set cleared)
drop       GSUB GPOS GDEF gasp DSIG STAT meta
unicodes   the character set above
then       encoded to woff2
```

If you add a non-ASCII character to any art or core string, regenerate this and
re-run the comparison.
