"use client";

import Link from "next/link";
import { CONTRACT_ADDRESS, activeChain, explorerAddressUrl } from "@/lib/config";

const X_HANDLE = "artoforb";
const ZERO = "0x0000000000000000000000000000000000000000";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.656l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25h6.826l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

/**
 * Deliberately a generic contract glyph rather than a reproduction of the
 * Etherscan mark: drawing someone's logo from memory gets it subtly wrong, and
 * the link is labelled anyway.
 */
function ContractIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M12 2.5 4.5 12 12 16.5 19.5 12z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.55"
        d="M4.5 14.6 12 21.5l7.5-6.9"
      />
    </svg>
  );
}

export function Footer() {
  const deployed = CONTRACT_ADDRESS && CONTRACT_ADDRESS !== ZERO;
  const explorer = explorerAddressUrl(CONTRACT_ADDRESS);

  return (
    <footer>
      {/*
       * The input equation and what the solution yields from it. They used to
       * sit at opposite ends of the page, implying a relationship that is not
       * there; as one line the reading order is the actual pipeline.
       */}
      <Link className="footer-math" href="/math" title="How a cubic becomes a shape">
        <span>x³ + ax² + bx + c = 0</span>
        <span className="footer-arrow">→</span>
        <span>Δ = −4p³ − 27q²</span>
        <span className="footer-sep">·</span>
        <span>ω = (−1 + i√3) / 2</span>
      </Link>

      <div className="footer-links">
        {activeChain.id === 31337 && <span className="footer-chain">local</span>}

        <a
          className="icon-link"
          href={`https://x.com/${X_HANDLE}`}
          target="_blank"
          rel="noreferrer noopener"
          title={`@${X_HANDLE} on X`}
          aria-label={`@${X_HANDLE} on X`}
        >
          <XIcon />
        </a>

        {deployed && explorer ? (
          <a
            className="icon-link"
            href={explorer}
            target="_blank"
            rel="noreferrer noopener"
            title={`Contract on ${activeChain.name}`}
            aria-label={`Contract on ${activeChain.name}`}
          >
            <ContractIcon />
          </a>
        ) : (
          <span
            className="icon-link disabled"
            title="No contract configured for this build"
            aria-label="Contract not deployed"
          >
            <ContractIcon />
          </span>
        )}

        <span className="footer-name">Cubic Symmetry Engine</span>
      </div>
    </footer>
  );
}
