import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TransactionDetails } from "../../../api/explorer";
import { NextStepsRail } from "../TxDetail/NextStepsRail";

/**
 * Component-level check that the rail renders REAL links (an `href`, not a
 * decorative button) and stays silent when `nextStepsFor` has nothing to
 * offer. Branch coverage itself lives in the pure-function tests
 * (`explorerTxDetailNextSteps.test.ts`) — this file only checks the wiring.
 */

function tx(overrides: Partial<TransactionDetails> = {}): TransactionDetails {
  return {
    hash: "0x" + "ab".repeat(32),
    blockNumber: "1",
    blockHash: "0x0",
    transactionIndex: 0,
    from: "0x" + "11".repeat(20),
    to: "0x" + "22".repeat(20),
    value: "0",
    valuePLS: "0",
    gas: "100000",
    gasPrice: "1",
    gasUsed: "50000",
    effectiveGasPrice: "1",
    nonce: 0,
    input: "0x",
    status: "success",
    timestamp: 1,
    decodedInput: null,
    decodedLogs: [],
    rawLogs: [],
    internalTransactions: [],
    tokenTransfers: [],
    contractAddress: null,
    cumulativeGasUsed: "50000",
    type: "legacy",
    ...overrides,
  };
}

function renderRail(props: {
  transaction: TransactionDetails;
  chainId?: number;
  functionName?: string | null;
}) {
  return render(
    <MemoryRouter>
      <NextStepsRail
        tx={props.transaction}
        chainId={props.chainId ?? 369}
        functionName={props.functionName ?? null}
      />
    </MemoryRouter>,
  );
}

describe("<NextStepsRail />", () => {
  it("renders nothing for a plain successful call", () => {
    const { container } = renderRail({ transaction: tx() });
    expect(container).toBeEmptyDOMElement();
  });

  it("links the debugger step at the real /debugger/<hash> route for a revert", () => {
    renderRail({ transaction: tx({ status: "reverted" }) });
    const link = screen.getByRole("link", {
      name: /step through the revert in the opcode debugger/i,
    });
    expect(link).toHaveAttribute("href", `/eip155/369/debugger/${tx().hash}`);
  });

  it("adds a chain-scoped link to the sender for a failed transferFrom", () => {
    const from = "0x" + "33".repeat(20);
    renderRail({
      transaction: tx({
        status: "reverted",
        from,
        internalTransactions: [
          {
            from,
            to: "0x" + "44".repeat(20),
            value: "0",
            valuePLS: "0",
            type: "CALL",
            gas: "1000",
            gasUsed: "1000",
            input: "0x23b872dd0000",
            errCode: "execution reverted",
            isError: "1",
          },
        ],
      }),
      chainId: 369,
    });
    const link = screen.getByRole("link", {
      name: /open the sender's address/i,
    });
    expect(link).toHaveAttribute("href", `/eip155/369/address/${from}`);
  });

  it("links a fork-replay and a Web3 Action for a successful swap", () => {
    renderRail({
      transaction: tx({ status: "success" }),
      functionName: "swapExactTokensForTokens",
    });
    const fork = screen.getByRole("link", { name: /fork-replay/i });
    expect(fork).toHaveAttribute("href", `/eip155/369/fork?fromTx=${tx().hash}`);
    const actions = screen.getByRole("link", { name: /wire a web3 action/i });
    expect(actions).toHaveAttribute("href", "/eip155/369/actions");
  });
});
