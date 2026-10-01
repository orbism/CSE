"use client";

import { useEffect, useState } from "react";

export const THEMES = ["phosphor", "amber", "cobalt", "bloom", "ember", "prism"] as const;
export const THEME_KEY = "cse-theme";

/**
 * Runs in <head> before first paint so a stored scheme never flashes the
 * default. Kept tiny and self-contained: it is inlined as a string.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(${JSON.stringify(
  THEMES,
)}.indexOf(t)>0)document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Repaint the tab icon in the live scheme: the ω-triad, three roots at thirds
 * of a turn, in the same colours as the wordmark's C, S and E. Chrome, Edge and
 * Firefox follow a swapped icon; Safari keeps the one it loaded first.
 */
function paintFavicon() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="6" fill="${v("--bg")}"/>` +
    `<rect x="1" y="1" width="30" height="30" rx="5" fill="none" stroke="${v("--line-bright")}" stroke-width="1.5"/>` +
    `<path d="M16 8.5 22.5 19.75H9.5Z" fill="none" stroke="${v("--line-bright")}" stroke-width="1.2"/>` +
    `<circle cx="16" cy="8.5" r="4" fill="${v("--mark-c")}"/>` +
    `<circle cx="22.5" cy="19.75" r="4" fill="${v("--mark-s")}"/>` +
    `<circle cx="9.5" cy="19.75" r="4" fill="${v("--mark-e")}"/></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((l) => (l.href = href));
}

/**
 * Square switch; each click moves to the next scheme. The dot inherits the
 * live scheme's colours from <html>, so it is always the current scheme's icon
 * with no state needed to draw it; CSS fades those colours while the dot turns
 * a sixth per click. `turns` only ever grows, so it always turns forward.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<string>(THEMES[0]);
  const [turns, setTurns] = useState(0);

  useEffect(() => {
    const t = document.documentElement.dataset.theme ?? THEMES[0];
    setTheme(t);
    setTurns(Math.max(0, THEMES.indexOf(t as (typeof THEMES)[number])));
    paintFavicon();
  }, []);

  const next = () => {
    const t = THEMES[(THEMES.indexOf(theme as (typeof THEMES)[number]) + 1) % THEMES.length];
    setTurns((n) => n + 1);
    document.documentElement.dataset.theme = t;
    paintFavicon();
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // private mode: the scheme just won't persist
    }
    setTheme(t);
  };

  return (
    <button className="theme-switch" onClick={next} title={`Scheme: ${theme} · click for next`}>
      <span className="theme-dot" style={{ transform: `rotate(${turns * 60}deg)` }} aria-hidden />
      <span className="sr-only">Colour scheme: {theme}</span>
    </button>
  );
}
