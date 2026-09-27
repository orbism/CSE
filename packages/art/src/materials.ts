import * as THREE from "three";
import type { Palette } from "@cse/core";

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
 */

/** Greyscale levels for the five ink bands. */
const GREY = [0.3, 0.45, 0.6, 0.78, 0.96];

export function surface(_palette: Palette, level: number, opts: { emissive?: number } = {}) {
  const g = GREY[Math.max(0, Math.min(4, level))];
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(g, g, g),
    emissive: new THREE.Color(g * 0.5, g * 0.5, g * 0.5),
    emissiveIntensity: opts.emissive ?? 0.12,
    roughness: 0.62,
    metalness: 0.05,
    flatShading: true,
  });
}

/** Unlit, saturated — the glyph pass detects chroma and assigns the accent ink. */
export function accent(_palette: Palette) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.28, 0.05) });
}

export function wire(_palette: Palette, level: number, opacity = 1) {
  const g = GREY[Math.max(0, Math.min(4, level))];
  return new THREE.LineBasicMaterial({
    color: new THREE.Color(g, g, g),
    transparent: opacity < 1,
    opacity,
  });
}

export function dots(_palette: Palette, level: number, size: number) {
  const g = GREY[Math.max(0, Math.min(4, level))];
  return new THREE.PointsMaterial({
    color: new THREE.Color(g, g, g),
    size,
    sizeAttenuation: true,
  });
}

export function addLights(scene: THREE.Scene, _palette: Palette) {
  // Low ambient and a strong key give surfaces a wide luminance gradient, which
  // is what the glyph ramp turns into readable form. High ambient flattens
  // everything into a single character.
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(4, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.85);
  fill.position.set(-6, -2, -5);
  scene.add(fill);
  const top = new THREE.DirectionalLight(0xffffff, 0.55);
  top.position.set(0, 10, -2);
  scene.add(top);
}
