/**
 * Minimal complex arithmetic. Deliberately dependency-free so this module runs
 * byte-identically in Node (generator) and the browser (art bundle, demo box).
 */

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });

export const ZERO: Cx = { re: 0, im: 0 };
export const ONE: Cx = { re: 1, im: 0 };

/** Primitive cube root of unity, omega = (-1 + i*sqrt(3)) / 2. */
export const OMEGA: Cx = { re: -0.5, im: Math.sqrt(3) / 2 };
/** omega^2, the conjugate of omega. */
export const OMEGA2: Cx = { re: -0.5, im: -Math.sqrt(3) / 2 };

export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const neg = (a: Cx): Cx => ({ re: -a.re, im: -a.im });
export const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
export const scale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });

export const mul = (a: Cx, b: Cx): Cx => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

export const abs = (a: Cx): number => Math.hypot(a.re, a.im);
export const arg = (a: Cx): number => Math.atan2(a.im, a.re);
export const norm2 = (a: Cx): number => a.re * a.re + a.im * a.im;

/** Principal square root (branch cut on the negative real axis). */
export const sqrt = (a: Cx): Cx => {
  const r = abs(a);
  if (r === 0) return { re: 0, im: 0 };
  const t = arg(a) / 2;
  const m = Math.sqrt(r);
  return { re: m * Math.cos(t), im: m * Math.sin(t) };
};

/** Principal cube root: modulus^(1/3), argument/3. */
export const cbrt = (a: Cx): Cx => {
  const r = abs(a);
  if (r === 0) return { re: 0, im: 0 };
  const t = arg(a) / 3;
  const m = Math.cbrt(r);
  return { re: m * Math.cos(t), im: m * Math.sin(t) };
};

/** True when the imaginary part is negligible relative to the modulus. */
export const isReal = (a: Cx, eps = 1e-9): boolean =>
  Math.abs(a.im) <= eps * Math.max(1, abs(a));

/** Round tiny float dust to exact zero so downstream classification is stable. */
export const clean = (a: Cx, eps = 1e-12): Cx => ({
  re: Math.abs(a.re) < eps ? 0 : a.re,
  im: Math.abs(a.im) < eps ? 0 : a.im,
});

export const fmt = (a: Cx, digits = 4): string => {
  const re = a.re.toFixed(digits);
  if (Math.abs(a.im) < 5e-5) return re;
  const sign = a.im < 0 ? "-" : "+";
  return `${re} ${sign} ${Math.abs(a.im).toFixed(digits)}i`;
};
