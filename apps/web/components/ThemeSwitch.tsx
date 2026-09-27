"use client";

import { useEffect, useState } from "react";

export const THEMES = ["phosphor", "amber", "cobalt", "bloom"] as const;
export const THEME_KEY = "cse-theme";

/**
 * Runs in <head> before first paint so a stored scheme never flashes the
 * default. Kept tiny and self-contained: it is inlined as a string.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(${JSON.stringify(
  THEMES,
)}.indexOf(t)>0)document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Square switch; each click moves to the next scheme. The dot inherits the
 * live scheme's colours from <html>, so it is always the current scheme's icon
 * with no state needed to draw it.
 */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<string>(THEMES[0]);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? THEMES[0]);
  }, []);

  const next = () => {
    const t = THEMES[(THEMES.indexOf(theme as (typeof THEMES)[number]) + 1) % THEMES.length];
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // private mode: the scheme just won't persist
    }
    setTheme(t);
  };

  return (
    <button className="theme-switch" onClick={next} title={`Scheme: ${theme} — click for next`}>
      <span className="theme-dot" aria-hidden />
      <span className="sr-only">Colour scheme: {theme}</span>
    </button>
  );
}
