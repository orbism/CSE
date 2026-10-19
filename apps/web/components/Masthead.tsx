"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConnectButton } from "./ConnectButton";
import { RadioSpectrum } from "./RadioSpectrum";
import { ThemeSwitch } from "./ThemeSwitch";

const RULE = "═".repeat(400);

/** Items with several words cycle through them; the first word is home and rests longest. */
const NAV = [
  { href: "/", words: ["the lab"], hint: "build your own form, not mintable" },
  { href: "/input", words: ["mint", "input", "solve", "roll"], hint: "the collection and the mint" },
  { href: "/output", words: ["gallery", "output", "solves", "the art"], hint: "every Form, filterable" },
  { href: "/allowlist", words: ["allowlist"], hint: "enter the raffle for the allowlist window" },
  { href: "/art", words: ["about:art"], hint: "why this looks the way it does" },
  { href: "/math", words: ["about:math"], hint: "how a cubic becomes a shape" },
];

const REST_MS = 9000; // on the home word
const HOLD_MS = 2200; // on the others
const BACK_MS = 22; // per character, backspacing
const TYPE_MS = 34; // per character, typing

/** Backspace the current word out and type the next one in, cursor showing while it happens. */
function useCycle(words: string[]) {
  const [state, set] = useState({ text: words[0], typing: false });
  useEffect(() => {
    if (words.length < 2) return;
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    (async () => {
      let i = 0;
      while (alive) {
        await wait(i === 0 ? REST_MS : HOLD_MS);
        const from = words[i];
        i = (i + 1) % words.length;
        const to = words[i];
        for (let n = from.length - 1; n >= 0 && alive; n--) {
          set({ text: from.slice(0, n), typing: true });
          await wait(BACK_MS);
        }
        for (let n = 1; n <= to.length && alive; n++) {
          set({ text: to.slice(0, n), typing: true });
          await wait(TYPE_MS);
        }
        if (alive) set({ text: to, typing: false });
      }
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [words]);
  return state;
}

function NavItem({
  item,
  on,
  onHover,
  register,
}: {
  item: (typeof NAV)[number];
  on: boolean;
  onHover: (href: string | null) => void;
  register: (href: string, el: HTMLAnchorElement | null) => void;
}) {
  const { text, typing } = useCycle(item.words);
  // the cell is sized by its longest word (plus cursor), so retyping never moves the neighbours
  const longest = item.words.reduce((a, b) => (b.length > a.length ? b : a));
  return (
    <Link
      href={item.href}
      title={item.hint}
      ref={(el) => register(item.href, el)}
      className={[on ? "on" : "", typing ? "typing" : ""].join(" ").trim() || undefined}
      onMouseEnter={() => onHover(item.href)}
      onFocus={() => onHover(item.href)}
    >
      <span className="nav-sizer" aria-hidden>
        {longest}
        {item.words.length > 1 && "▮"}
      </span>
      <span className="nav-text">
        {text}
        {typing && <span className="nav-cursor">▮</span>}
      </span>
    </Link>
  );
}

export function Masthead() {
  const pathname = usePathname();
  const active = NAV.find((n) => n.href === pathname)?.href ?? null;
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState<{ x: number; w: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const items = useRef(new Map<string, HTMLAnchorElement>());
  const target = hover ?? active;

  // the menu closes itself on navigation
  useEffect(() => setOpen(false), [pathname]);

  // The underline sits under whichever item the pointer is on, else the active
  // one. Measured off the layout so the equal-width cells, not the text, set it.
  useLayoutEffect(() => {
    const place = () => {
      const el = target ? items.current.get(target) : null;
      setLine(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [target]);

  // shrink while travelling, back to full once it lands
  useEffect(() => {
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 320);
    return () => clearTimeout(t);
  }, [target]);

  return (
    <>
      <header className="masthead">
        <div>
          <Link href="/" className="wordmark">
            <h1>
              <WordmarkText />
            </h1>
          </Link>
          {/* The radio's spectrum hangs under the nav, as wide as it, rising off
              the header's bottom rule. */}
          <div className="nav-wrap">
            <button
              className="nav-burger"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "×" : "☰"}
            </button>
            <nav className={`nav${open ? " open" : ""}`} onMouseLeave={() => setHover(null)}>
              {NAV.map((n, i) => (
                <Fragment key={n.href}>
                  {i > 0 && <span className="nav-sep">|</span>}
                  <NavItem
                    item={n}
                    on={active === n.href}
                    onHover={setHover}
                    register={(href, el) => (el ? items.current.set(href, el) : items.current.delete(href))}
                  />
                </Fragment>
              ))}
              <span
                className={`nav-line${moving ? " moving" : ""}`}
                style={line ? { left: line.x, width: line.w } : { width: 0 }}
                aria-hidden
              />
            </nav>
            <RadioSpectrum className="nav-spectrum" />
          </div>
        </div>
        <div className="masthead-tools">
          <ThemeSwitch />
          <ConnectButton />
        </div>
      </header>

      <div className="ansi-rule">{RULE}</div>
    </>
  );
}

/** The three lines, initials picked out in the scheme's colours. */
export function WordmarkText() {
  return (
    <>
      <span className="mark-c">C</span>ubic
      <br />
      <span className="mark-s">S</span>ymmetry
      <br />
      <span className="mark-e">E</span>ngine
    </>
  );
}

export function Rule() {
  return <div className="ansi-rule">{RULE}</div>;
}
