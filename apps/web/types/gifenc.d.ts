/**
 * gifenc ships no types. Only the three entry points the exporter uses are
 * declared, rather than pulling in a hand-written full surface that would drift.
 */
declare module "gifenc" {
  export interface WriteFrameOpts {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    dispose?: number;
    repeat?: number;
  }

  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoder;

  /** Builds an up-to-`maxColors` palette from RGBA pixel data. */
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean; clearAlpha?: boolean },
  ): number[][];

  /** Maps RGBA pixel data onto a palette, returning one index per pixel. */
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
