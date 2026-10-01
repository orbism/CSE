"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { ThemeSwitch } from "./ThemeSwitch";

const RULE = "═".repeat(400);

const NAV = [
  { href: "/", label: "input", hint: "the collection and the mint" },
  { href: "/output", label: "output", hint: "every Form, filterable" },
  { href: "/art", label: "art", hint: "why this looks the way it does" },
  { href: "/math", label: "math", hint: "how a cubic becomes a shape" },
  { href: "/lab", label: "lab", hint: "build your own form, not mintable" },
];

export function Masthead() {
  const pathname = usePathname();

  return (
    <>
      <header className="masthead">
        <div>
          <Link href="/" className="wordmark">
            <h1>
              <WordmarkText />
            </h1>
          </Link>
          <nav className="nav">
            {NAV.map((n, i) => (
              <span key={n.href}>
                {i > 0 && <span className="nav-sep">|</span>}
                <Link
                  href={n.href}
                  title={n.hint}
                  className={pathname === n.href ? "on" : undefined}
                >
                  {n.label}
                </Link>
              </span>
            ))}
          </nav>
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
