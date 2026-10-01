import type { Palette } from "@cse/core";
import * as GL from "./gl/index.js";

/**
 * The 3D pass renders greyscale on purpose.
 *
 * Colour is applied later, by the glyph pass, from the palette ramp. Rendering
 * the scene in the palette's own (deliberately dark) inks would crush the whole
 * image into the bottom two glyphs; keeping the render greyscale means the full
 * 0..255 range is available for luminance, and the palette stays a clean
 * quantised ANSI ramp rather than a muddy gradient.
 *
 * The one exception is `accent`: root markers are rendered highly saturated so
 * the pass can pick them out by chroma and give them the accent ink.
 *
 * Written against a kit of classes rather than one library: the collection
 * renders with the CSE engine (`./gl`), the Lab with three.js, and both share
 * these exact materials and lights. The two expose the same names.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor = new (...args: any[]) => any;
export interface MaterialKit {
  Color: Ctor;
  MeshStandardMaterial: Ctor;
  MeshBasicMaterial: Ctor;
  LineBasicMaterial: Ctor;
  PointsMaterial: Ctor;
  AmbientLight: Ctor;
  DirectionalLight: Ctor;
}

/** Greyscale levels for the five ink bands. */
const GREY = [0.3, 0.45, 0.6, 0.78, 0.96];
const grey = (level: number) => GREY[Math.max(0, Math.min(4, level))];

export function makeMaterials<K extends MaterialKit>(K: K) {
  return {
    surface(_palette: Palette, level: number, opts: { emissive?: number } = {}): InstanceType<K["MeshStandardMaterial"]> {
      const g = grey(level);
      return new K.MeshStandardMaterial({
        color: new K.Color(g, g, g),
        emissive: new K.Color(g * 0.5, g * 0.5, g * 0.5),
        emissiveIntensity: opts.emissive ?? 0.12,
        roughness: 0.62,
        metalness: 0.05,
        flatShading: true,
      });
    },

    /** Unlit, saturated — the glyph pass detects chroma and assigns the accent ink. */
    accent(_palette: Palette): InstanceType<K["MeshBasicMaterial"]> {
      return new K.MeshBasicMaterial({ color: new K.Color(1.0, 0.28, 0.05) });
    },

    wire(_palette: Palette, level: number, opacity = 1): InstanceType<K["LineBasicMaterial"]> {
      const g = grey(level);
      return new K.LineBasicMaterial({ color: new K.Color(g, g, g), transparent: opacity < 1, opacity });
    },

    dots(_palette: Palette, level: number, size: number): InstanceType<K["PointsMaterial"]> {
      const g = grey(level);
      return new K.PointsMaterial({ color: new K.Color(g, g, g), size, sizeAttenuation: true });
    },

    addLights(scene: { add(o: unknown): unknown }, _palette: Palette) {
      // Low ambient and a strong key give surfaces a wide luminance gradient, which
      // is what the glyph ramp turns into readable form. High ambient flattens
      // everything into a single character.
      scene.add(new K.AmbientLight(0xffffff, 0.35));
      const key = new K.DirectionalLight(0xffffff, 2.8);
      key.position.set(4, 6, 8);
      scene.add(key);
      const fill = new K.DirectionalLight(0xffffff, 0.85);
      fill.position.set(-6, -2, -5);
      scene.add(fill);
      const top = new K.DirectionalLight(0xffffff, 0.55);
      top.position.set(0, 10, -2);
      scene.add(top);
    },
  };
}

/** The collection's materials, on the CSE engine. */
export const { surface, accent, wire, dots, addLights } = makeMaterials(GL);
