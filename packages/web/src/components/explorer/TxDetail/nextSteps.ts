import { scanPath } from "../../../lib/scanRoutes";
import { chainRoutePrefix } from "../../../lib/chainScope";

/**
 * A tool route, kept on the chain the reader is already looking at.
 *
 * `scanPath` only knows the entity routes (tx/block/address/contract), so
 * the tool pages need the prefix applied directly. Without it these links
 * drop chain scope: from a page at `/eip155/1/tx/…`, a bare `/simulate`
 * collapses to the default chain, so the reader silently changes chain by
 * following a suggestion. An unregistered chain yields an empty prefix and
 * the bare path, which is the existing convention.
 */
function toolPath(chainId: number, path: string): string {
  return `${chainRoutePrefix(chainId)}${path}`;
}

/**
 * Adaptive "next steps" rail — domain logic.
 *
 * Ported from `components/drafts/JourneyDraft.tsx`'s `nextStepsFor()`. The
 * mockup's branches were a hypothesis, not gospel: real transaction data
 * (`TransactionDetails`, from `api/explorer.ts`) has no revert-reason
 * string, so a `TRANSFER_FROM_FAILED`-style branch can't be driven by
 * matching that text. It IS still derivable from a real signal already on
 * the page: a failed internal call whose input starts with the
 * `transferFrom(address,address,uint256)` selector. Branches that need
 * data the page doesn't already have (a decoded state diff for a mined tx,
 * a lookup of the sender's last reverted swap) are dropped rather than
 * faked.
 */

/** `transferFrom(address,address,uint256)` selector. */
const TRANSFER_FROM_SELECTOR = "0x23b872dd";

export interface NextStepFacts {
  status: "success" | "reverted" | "pending";
  hash: string;
  fromAddress: string;
  /** Decoded function name for the top-level call, if known. */
  functionName: string | null;
  /** A call inside this transaction's trace called transferFrom and failed. */
  hasFailedTransferFrom: boolean;
}

export interface NextStep {
  id: string;
  /**
   * The two-or-three word name on the button face.
   *
   * `label` is a full sentence, which is right for a tooltip and wrong for a
   * control — four stacked sentence-length cards cost more vertical space than
   * the transaction summary above them and read as an interruption. The button
   * says what it does; the tooltip says why.
   */
  short: string;
  label: string;
  sub: string;
  icon: string;
  /** A real, working in-app path. Never render a step without one. */
  to: string;
  primary?: boolean;
}

/** True when an internal call failed while calling `transferFrom`. */
export function hasFailedTransferFrom(
  internalTransactions: { input: string; isError: string }[],
): boolean {
  return internalTransactions.some(
    (t) =>
      t.isError === "1" &&
      t.input.toLowerCase().startsWith(TRANSFER_FROM_SELECTOR),
  );
}

/**
 * Swap entry points whose NAME never contains the word "swap". Uniswap V3's
 * router is the big one: `exactInputSingle` is the single most common swap
 * on Ethereum, and a `/swap/i` test cannot see it.
 *
 * Measured against production on 2026-08-25 — 40 blocks of chain 1 (11,609
 * transactions) and 60 blocks of chain 369 (4,592):
 *
 *   chain 1    202 named swaps matched, 88 missed  -> 30.3% invisible
 *   chain 369  117 named swaps matched, 16 missed  -> 12.0% invisible
 *
 * Almost all of the miss is `exactInputSingle` (86 of 88 on chain 1). These
 * are anchored at the start of the name, not searched anywhere inside it, so
 * an unrelated function that merely ends in "route" does not match.
 */
const SWAP_SEMANTIC_PREFIXES =
  /^(exactInput|exactOutput|unoswap|clipperSwap|sellToUniswap|sellToken|buyToken|fillOtcOrder|fillQuote)/i;

/**
 * True when the top-level call is a swap.
 *
 * Deliberately name-only. A wrapper — `multicall`, `execute`, `aggregate3` —
 * hides whatever it wraps behind its own name, and this function sees only
 * the outer name, so a wrapped swap reads as a non-swap here. That gap is
 * measured and left open on purpose: over the same sample, direct swaps beat
 * wrappers 117:100 on chain 369 while wrappers beat direct swaps 350:186 on
 * chain 1, and both sit near 2-3% of all traffic. Unwrapping them means
 * decoding calldata argument-by-argument for a minority of a minority, so it
 * is a product decision, not a regex tweak. See progress.txt "OPEN".
 */
function isSwap(functionName: string | null): boolean {
  if (functionName === null) return false;
  return (
    /swap/i.test(functionName) || SWAP_SEMANTIC_PREFIXES.test(functionName)
  );
}

/**
 * Maps a transaction's real outcome to the ordered list of "what to do
 * next" steps. Each branch is independent — dropping or reordering one
 * outcome's steps doesn't disturb the others.
 */
export function nextStepsFor(
  facts: NextStepFacts,
  chainId: number,
): NextStep[] {
  if (facts.status === "reverted") {
    const debug: NextStep = {
      id: "debug",
      short: "Step through revert",
      primary: true,
      icon: "heroicons:bug-ant",
      label: "Step through the revert in the opcode debugger",
      sub: "Find the exact program counter where execution stopped",
      to: toolPath(chainId, `/debugger/${facts.hash}`),
    };

    if (facts.hasFailedTransferFrom) {
      return [
        debug,
        {
          id: "allowance",
          short: "Open sender",
          icon: "heroicons:shield-check",
          // Deliberately does NOT say "check the allowance": no view in this
          // app shows an ERC-20 allowance, so promising one sends the reader
          // looking for a control that isn't there. The link opens the
          // sender; the subline says what to suspect.
          label: "Open the sender's address",
          sub: "A failed transferFrom usually means a missing approval",
          to: scanPath("address", facts.fromAddress, chainId),
        },
        {
          id: "resimulate",
          short: "Re-simulate",
          icon: "heroicons:arrow-path",
          label: "Re-simulate with a state override",
          sub: "Opens the simulator — the call is not carried over yet",
          to: toolPath(chainId, "/simulate"),
        },
        {
          id: "alert",
          short: "Add failure alert",
          icon: "heroicons:bell-alert",
          label: "Set up a failure alert for this contract",
          sub: "Catch the next failure before it gets reported",
          to: toolPath(chainId, "/monitoring"),
        },
      ];
    }

    return [
      debug,
      {
        id: "resimulate",
        short: "Re-simulate",
        icon: "heroicons:arrow-path",
        label: "Re-simulate with state overrides",
        sub: "Opens the simulator — the call is not carried over yet",
        to: toolPath(chainId, "/simulate"),
      },
      {
        id: "alert",
        short: "Add failure alert",
        icon: "heroicons:bell-alert",
        label: "Set up a failure alert for this contract",
        sub: "Get notified the next time this reverts",
        to: toolPath(chainId, "/monitoring"),
      },
    ];
  }

  if (facts.status === "success" && isSwap(facts.functionName)) {
    return [
      {
        id: "fork",
        short: "Fork-replay",
        primary: true,
        icon: "heroicons:beaker",
        label: "Fork-replay at this block to test a variant",
        sub: "Spin up a testnet seeded with this tx as the head",
        to: toolPath(chainId, `/fork?fromTx=${facts.hash}`),
      },
      {
        id: "actions",
        short: "Wire an action",
        icon: "heroicons:bolt",
        label: "Wire a Web3 Action to react to swaps like this",
        sub: "Trigger alerts or automations off similar activity",
        to: toolPath(chainId, "/actions"),
      },
    ];
  }

  // Pending, or a successful call we have no confident suggestion for
  // (real explorer data carries no per-slot state diff outside a
  // simulation, so we don't fake the mockup's "Inspect the state diff").
  return [];
}
