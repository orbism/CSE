/** Family name the glyph pass draws with. */
export const GLYPH_FONT = "CSEGlyph";

/**
 * JetBrains Mono advance width is 600/1000 em. The glyph grid uses this to pick
 * a column count that tiles a square canvas with square-ish cells.
 */
export const CELL_ASPECT = 0.6;

const loaded = new Map<string, Promise<void>>();

/**
 * Load the glyph font from `source`, which is anything a CSS url() accepts.
 *
 * The source is a parameter rather than a baked-in import because the two
 * consumers need different things: the pinned bundle inlines the woff2 as a
 * data URI (it must run from IPFS with no network), while the site serves it
 * from /fonts. Hard-coding a bundler-specific `?url` import here would break
 * whichever consumer is not Vite.
 */
export function loadGlyphFont(source: string): Promise<void> {
  const existing = loaded.get(source);
  if (existing) return existing;

  const promise = (async () => {
    const face = new FontFace(GLYPH_FONT, `url(${source}) format("woff2")`);
    await face.load();
    // FontFaceSet.add is a Set method the DOM lib types omit on this target
    (document.fonts as unknown as Set<FontFace>).add(face);
    await document.fonts.ready;
  })();

  loaded.set(source, promise);
  return promise;
}
