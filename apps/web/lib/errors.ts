import { COLLECTION } from "@cse/core";

export interface FriendlyError {
  /** One short sentence. Always safe to show on its own. */
  title: string;
  /** What to do about it, when there is something useful to say. */
  detail?: string;
  /** Not really a failure — the user chose to stop. */
  benign?: boolean;
}

/** Reverts the mint path can produce, in the words of someone who is not a dev. */
const REVERTS: Record<string, FriendlyError> = {
  MintNotLive: {
    title: "The mint is not open",
    detail: "It has either not started yet or has already finished.",
  },
  SupplyExhausted: {
    title: "Sold out",
    detail: `All ${COLLECTION.supply} Forms have been claimed.`,
  },
  WalletLimitExceeded: {
    title: `You have reached the ${COLLECTION.maxPerWallet} per wallet limit`,
    detail: "Mint from another wallet to claim more.",
  },
  IncorrectPayment: {
    title: "Wrong amount sent",
    detail: "The price changed while you were deciding. Reload and try again.",
  },
  AlreadyMinted: {
    title: "Someone took that one first",
    detail: "Solve again for another Form.",
  },
  InvalidTokenId: {
    title: "That Form does not exist",
    detail: `Ids run from 1 to ${COLLECTION.supply}.`,
  },
  InvalidQuantity: { title: "Nothing selected to mint" },
  OwnableUnauthorizedAccount: {
    title: "That action is owner-only",
    detail: "This wallet cannot perform it.",
  },
};

/** Patterns worth catching from providers, which do not use typed errors. */
const PATTERNS: [RegExp, FriendlyError][] = [
  [
    /insufficient funds|exceeds the balance|gas \* price \+ value/i,
    {
      title: "Not enough ETH",
      detail: "You need the mint price plus a little for gas.",
    },
  ],
  [
    /user rejected|user denied|rejected the request|action_rejected/i,
    { title: "Cancelled in your wallet", benign: true },
  ],
  [
    /does not match the target chain|chain mismatch|unrecognized chain/i,
    {
      title: "Wrong network",
      detail: "Switch your wallet to the network this collection lives on.",
    },
  ],
  [
    /nonce too low|already known|replacement transaction underpriced/i,
    {
      title: "A transaction is already pending",
      detail: "Wait for it to finish, or speed it up in your wallet.",
    },
  ],
  [
    /intrinsic gas too low|gas required exceeds|out of gas/i,
    { title: "The transaction ran out of gas", detail: "Try again with a higher gas limit." },
  ],
  [
    /failed to fetch|network error|timeout|econnrefused|fetch failed/i,
    {
      title: "Could not reach the network",
      detail: "Check your connection and try again.",
    },
  ],
  [
    /transaction underpriced|max fee per gas less than/i,
    { title: "Gas price too low", detail: "The network got busier. Try again." },
  ],
];

interface ErrorLike {
  name?: string;
  message?: string;
  shortMessage?: string;
  details?: string;
  reason?: string;
  code?: number | string;
  data?: { errorName?: string };
  cause?: unknown;
}

/**
 * Every error in the `cause` chain, innermost last.
 *
 * Deliberately structural rather than `instanceof`. There are five copies of
 * viem in this dependency tree and wagmi resolves a different one than the app
 * does, so `err instanceof BaseError` is false for the very errors this needs
 * to read — in the browser as well as in tests. Matching on `name` works
 * regardless of which copy constructed it.
 */
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let cur = error as ErrorLike | undefined;
  while (cur && out.length < 12) {
    out.push(cur);
    cur = cur.cause as ErrorLike | undefined;
  }
  return out;
}

/**
 * Turn whatever a wallet, node or contract threw into something readable.
 *
 * Wallet errors arrive as deeply nested objects whose useful part is often
 * several lines into `message`, so `message.split("\n")[0]` reliably showed the
 * least informative sentence available — "the contract function reverted with
 * the following reason:" and nothing after it.
 */
export function describeTxError(error: unknown): FriendlyError {
  if (!error) return { title: "Something went wrong" };

  const links = chain(error);

  // A decoded custom error is the most specific thing available, so look for it
  // before falling back to string matching.
  for (const link of links) {
    if (link.name !== "ContractFunctionRevertedError") continue;
    const name = link.data?.errorName ?? link.reason;
    if (name && REVERTS[name]) return REVERTS[name];
    if (name) return { title: `The contract rejected this: ${name}` };
  }

  for (const link of links) {
    if (link.name === "UserRejectedRequestError" || link.code === 4001) {
      return { title: "Cancelled in your wallet", benign: true };
    }
    if (link.name === "InsufficientFundsError") {
      return {
        title: "Not enough ETH",
        detail: "You need the mint price plus a little for gas.",
      };
    }
  }

  // Search the whole chain, not just the outermost error: the useful sentence
  // is usually on an inner link.
  const text = links
    .flatMap((l) => [l.shortMessage, l.details, l.message])
    .filter(Boolean)
    .join(" — ");

  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(text)) return friendly;
  }

  // Nothing matched. Prefer viem's short message over the full stack-like blob,
  // and never return the empty-reason string on its own.
  const short = links.find((l) => l.shortMessage)?.shortMessage;
  const cleaned = short && !/reverted with the following reason:\s*$/.test(short) ? short : null;
  return {
    title: cleaned ?? "The transaction failed",
    detail: cleaned ? undefined : "Your wallet or the network rejected it without saying why.",
  };
}
