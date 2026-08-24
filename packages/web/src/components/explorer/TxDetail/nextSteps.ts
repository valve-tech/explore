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

function isSwap(functionName: string | null): boolean {
  return functionName !== null && /swap/i.test(functionName);
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
          icon: "heroicons:shield-check",
          label: "Check token allowance on the source address",
          sub: "A failed transferFrom is usually a missing approval",
          to: scanPath("address", facts.fromAddress, chainId),
        },
        {
          id: "resimulate",
          icon: "heroicons:arrow-path",
          label: "Re-simulate with an approval override",
          sub: "Confirm the fix would work without spending real gas",
          to: toolPath(chainId, "/simulate"),
        },
        {
          id: "alert",
          icon: "heroicons:bell-alert",
          label: "Pin this contract for a future failure alert",
          sub: "Catch the next failure before it gets reported",
          to: toolPath(chainId, "/monitoring"),
        },
      ];
    }

    return [
      debug,
      {
        id: "resimulate",
        icon: "heroicons:arrow-path",
        label: "Re-simulate with state overrides",
        sub: "Test a hypothesis without spending gas",
        to: toolPath(chainId, "/simulate"),
      },
      {
        id: "alert",
        icon: "heroicons:bell-alert",
        label: "Pin this contract for a future failure alert",
        sub: "Get notified the next time this reverts",
        to: toolPath(chainId, "/monitoring"),
      },
    ];
  }

  if (facts.status === "success" && isSwap(facts.functionName)) {
    return [
      {
        id: "fork",
        primary: true,
        icon: "heroicons:beaker",
        label: "Fork-replay at this block to test a variant",
        sub: "Spin up a testnet seeded with this tx as the head",
        to: toolPath(chainId, `/fork?fromTx=${facts.hash}`),
      },
      {
        id: "actions",
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
