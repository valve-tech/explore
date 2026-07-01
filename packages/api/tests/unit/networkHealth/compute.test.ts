import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBlock,
  computeLadder,
  serializeBlock,
  aggregateWindow,
} from "../../../src/services/networkHealth/compute.js";
import type {
  BlockInput,
  TxInput,
} from "../../../src/services/networkHealth/types.js";

/**
 * Pure-compute correctness for the network-health analysis. The worked block
 * below has hand-computed expectations; see comments for the arithmetic.
 *
 *   baseFee = 100, burnsBaseFee = true
 *   tx0  idx0  type2  from A  gas100  eff250  → tip 150
 *   tx1  idx1  type0  from B  gas200  eff180  → tip  80   (legacy bucket)
 *   tx2  idx2  type2  from C  gas100  eff300  → tip 200
 */

function tx(
  transactionIndex: number,
  type: number,
  from: string,
  gasUsed: bigint,
  effectiveGasPrice: bigint,
): TxInput {
  return { transactionIndex, type, from, gasUsed, effectiveGasPrice };
}

function workedBlock(): BlockInput {
  return {
    number: 1000n,
    timestamp: 1_700_000_000,
    baseFeePerGas: 100n,
    gasUsed: 400n,
    gasLimit: 1000n,
    miner: "0xminer",
    txs: [
      tx(0, 2, "0xa", 100n, 250n),
      tx(1, 0, "0xb", 200n, 180n),
      tx(2, 2, "0xc", 100n, 300n),
    ],
  };
}

describe("computeBlock — composition", () => {
  it("gas-weighted legacy share and count share", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    // legacy gas = 200 (tx1) / 400 total = 0.5
    assert.equal(s.legacyGasShare, 0.5);
    // 1 of 3 txns is legacy
    assert.ok(Math.abs(s.legacyCountShare - 1 / 3) < 1e-9);
    assert.equal(s.txCount, 3);
  });
});

describe("computeBlock — burn vs tip vs paid", () => {
  it("paid = burned + tips, split by type, under burn", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    // burned = base*gas: tx0 10000(m), tx1 20000(l), tx2 10000(m)
    assert.equal(s.burnedByType.legacy, "20000");
    assert.equal(s.burnedByType.modern, "20000");
    assert.equal(s.burned, "40000");
    // tips = tip*gas: tx0 15000(m), tx1 16000(l), tx2 20000(m)
    assert.equal(s.tipsByType.legacy, "16000");
    assert.equal(s.tipsByType.modern, "35000");
    assert.equal(s.tips, "51000");
    // paid = eff*gas: tx0 25000(m), tx1 36000(l), tx2 30000(m)
    assert.equal(s.paidByType.legacy, "36000");
    assert.equal(s.paidByType.modern, "55000");
    assert.equal(s.paid, "91000");
    // identity holds
    assert.equal(BigInt(s.burned) + BigInt(s.tips), BigInt(s.paid));
    // burnedShare = 40000/91000
    assert.ok(Math.abs(s.burnedShare - 40000 / 91000) < 1e-5);
  });

  it("no burn: validator keeps full price, burned = 0", () => {
    const s = serializeBlock(
      computeBlock(workedBlock(), { burnsBaseFee: false }),
    );
    assert.equal(s.burned, "0");
    assert.equal(s.burnedShare, 0);
    // tips now equal paid (validator keeps everything)
    assert.equal(s.tips, s.paid);
  });
});

describe("computeBlock — positions", () => {
  it("gas-weighted average normalized position by type", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    // legacy is only tx1 at idx1 of 3 → position 0.5
    assert.equal(s.avgPositionByType.legacy, 0.5);
    // modern is tx0 (pos 0) and tx2 (pos 1), equal gas → 0.5
    assert.equal(s.avgPositionByType.modern, 0.5);
  });

  it("per-type position histogram normalizes to ~1", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(sum(s.positionHistogram.legacy) - 1) < 1e-6);
    assert.ok(Math.abs(sum(s.positionHistogram.modern) - 1) < 1e-6);
    // legacy concentrated in the middle bucket (idx1/2 → bucket 5)
    assert.equal(s.positionHistogram.legacy[5], 1);
  });
});

describe("computeBlock — prioritization", () => {
  it("gas-weighted out-of-order share = minimal displacement from fee order", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    // tips by position: A150(gas100), B80(gas200), C200(gas100). Fee order is
    // C200, A150, B80. The block is [A150, B80, C200]: A150→B80 is already
    // descending (in order, gas 100+200=300); only C200 (gas100) sits out of
    // place. So out-of-order = 100 / 400 total = 0.25 — NOT 0.75: the two txns
    // C leapfrogged are NOT counted, only the one displaced tx.
    assert.equal(s.priorityInversionRate, 0.25);
  });

  it("a single displaced tx counts once, not everyone it leapfrogged", () => {
    // The highest-fee tx moved from the front to the back. Only IT is out of
    // order; the remaining descending run is in order. 5 equal-gas txns → 1/5.
    const block: BlockInput = {
      number: 7n,
      timestamp: 1,
      baseFeePerGas: 0n,
      gasUsed: 5n,
      gasLimit: 100n,
      miner: "0xm",
      txs: [
        tx(0, 2, "0xa", 1n, 90n),
        tx(1, 2, "0xb", 1n, 80n),
        tx(2, 2, "0xc", 1n, 70n),
        tx(3, 2, "0xd", 1n, 60n),
        tx(4, 2, "0xe", 1n, 100n), // belongs at the front
      ],
    };
    const s = serializeBlock(computeBlock(block, { burnsBaseFee: true }));
    assert.ok(Math.abs(s.priorityInversionRate! - 1 / 5) < 1e-9);
  });

  it("treats near-equal tips (wei-level wobble) as the same fee tier", () => {
    // Three ~equal tips differing by 1 wei out of ~1e12 — descending order is
    // spurious; they must NOT read as out of order. A truly higher tail tx does.
    const block: BlockInput = {
      number: 8n,
      timestamp: 1,
      baseFeePerGas: 0n,
      gasUsed: 3n,
      gasLimit: 100n,
      miner: "0xm",
      txs: [
        tx(0, 2, "0xa", 1n, 1_000_000_000_001n),
        tx(1, 2, "0xb", 1n, 1_000_000_000_000n),
        tx(2, 2, "0xc", 1n, 999_999_999_999n),
      ],
    };
    const s = serializeBlock(computeBlock(block, { burnsBaseFee: true }));
    assert.equal(s.priorityInversionRate, 0); // all one tier → nothing displaced
  });

  it("counts a genuine displacement even next to a same-sender tx", () => {
    // Positions: A tip100, A tip300, B tip200. Fee order is A300, B200, A100 —
    // so A's first tx (tip100) is the one out of place at the front (the
    // descending run A300→B200 stays in order). ooo gas = 10 of 30 → 1/3.
    const block: BlockInput = {
      number: 9n,
      timestamp: 1,
      baseFeePerGas: 0n,
      gasUsed: 30n,
      gasLimit: 100n,
      miner: "0xm",
      txs: [
        tx(0, 2, "0xa", 10n, 100n),
        tx(1, 2, "0xa", 10n, 300n),
        tx(2, 2, "0xb", 10n, 200n),
      ],
    };
    const s = serializeBlock(computeBlock(block, { burnsBaseFee: true }));
    assert.ok(Math.abs(s.priorityInversionRate! - 1 / 3) < 1e-5);
  });

  it("excludes same-sender pairs from inversion accounting", () => {
    // Two txns from the same sender, later out-tips earlier — must NOT count.
    const block: BlockInput = {
      number: 1n,
      timestamp: 1,
      baseFeePerGas: 0n,
      gasUsed: 200n,
      gasLimit: 1000n,
      miner: "0xm",
      txs: [tx(0, 2, "0xsame", 100n, 100n), tx(1, 2, "0xsame", 100n, 999n)],
    };
    const s = serializeBlock(computeBlock(block, { burnsBaseFee: true }));
    // only comparable pair was same-sender → no pairs → null rate
    assert.equal(s.priorityInversionRate, null);
  });

  it("over-prioritized gas attributed by type", () => {
    const s = serializeBlock(computeBlock(workedBlock(), { burnsBaseFee: true }));
    // rev rank desc: tx2(200) tx0(150) tx1(80). tx0 placed at 0 (deserves 1) and
    // tx1 at 1 (deserves 2) jumped the queue; tx2 did not.
    assert.equal(s.overPrioritizedGasByType.modern, "100"); // tx0
    assert.equal(s.overPrioritizedGasByType.legacy, "200"); // tx1
  });

  it("single-tx block has no position spread and null inversion rate", () => {
    const block: BlockInput = {
      number: 5n,
      timestamp: 1,
      baseFeePerGas: 10n,
      gasUsed: 50n,
      gasLimit: 1000n,
      miner: "0xm",
      txs: [tx(0, 2, "0xa", 50n, 30n)],
    };
    const s = serializeBlock(computeBlock(block, { burnsBaseFee: true }));
    assert.equal(s.avgPositionByType.modern, 0);
    assert.equal(s.priorityInversionRate, null);
  });
});

describe("computeBlock — receipts arrive unordered", () => {
  it("sorts by transactionIndex before computing positions", () => {
    const b = workedBlock();
    const shuffled: BlockInput = { ...b, txs: [b.txs[2]!, b.txs[0]!, b.txs[1]!] };
    const ordered = serializeBlock(computeBlock(b, { burnsBaseFee: true }));
    const out = serializeBlock(computeBlock(shuffled, { burnsBaseFee: true }));
    assert.deepEqual(out, ordered);
  });
});

describe("computeLadder", () => {
  it("flags exactly the displaced txns, matching the block rate", () => {
    const l = computeLadder(workedBlock(), { burnsBaseFee: true });
    assert.equal(l.txs.length, 3);
    // Fee order is C200, A150, B80. The block is [A150, B80, C200]: A150→B80 is
    // already descending, so only C200 (gas100) is displaced.
    assert.equal(l.txs[0]!.outOfOrder, false); // A150
    assert.equal(l.txs[1]!.outOfOrder, false); // B80
    assert.equal(l.txs[2]!.outOfOrder, true); // C200 — the one out of place
    assert.equal(l.txs[1]!.type, "legacy");
    assert.equal(l.txs[0]!.position, 0);
    assert.equal(l.txs[0]!.gasUsed, "100"); // carried through for bar width
    // the flagged gas (100) over comparable (400) is exactly the block rate
    assert.equal(l.priorityInversionRate, 0.25);
  });

  it("marks the single displaced tx, not the ones it leapfrogged", () => {
    const block: BlockInput = {
      number: 9n,
      timestamp: 1,
      baseFeePerGas: 0n,
      gasUsed: 3n,
      gasLimit: 100n,
      miner: "0xm",
      txs: [
        tx(0, 2, "0xa", 1n, 100n),
        tx(1, 2, "0xa", 1n, 300n),
        tx(2, 2, "0xb", 1n, 200n),
      ],
    };
    const l = computeLadder(block, { burnsBaseFee: true });
    // Fee order 300, 200, 100 → the tip-100 tx at the front is displaced; the
    // descending run 300→200 stays in order.
    assert.deepEqual(
      l.txs.map((t) => t.outOfOrder),
      [true, false, false],
    );
  });
});

describe("aggregateWindow", () => {
  it("empty window", () => {
    const a = aggregateWindow([]);
    assert.equal(a.blocksAnalyzed, 0);
    assert.equal(a.fromBlock, null);
    assert.equal(a.priorityInversionRate, null);
    assert.equal(a.legacyGasShare, 0);
    assert.deepEqual(a.paidPerBlock, { avg: "0", median: "0", min: "0", max: "0" });
    assert.deepEqual(a.tipsPerBlock, { avg: "0", median: "0", min: "0", max: "0" });
  });

  it("per-block avg/median/range of paid + tips (native wei)", () => {
    // Three single-tx blocks, base 0 (→ tip == paid == eff × gas1), with paid
    // totals 100 / 500 / 300 wei.
    const blocks = [100n, 500n, 300n].map((eff, i) =>
      computeBlock(
        {
          number: BigInt(i),
          timestamp: 1,
          baseFeePerGas: 0n,
          gasUsed: 1n,
          gasLimit: 10n,
          miner: "0xm",
          txs: [tx(0, 2, "0xa", 1n, eff)],
        },
        { burnsBaseFee: true },
      ),
    );
    const a = aggregateWindow(blocks);
    // paid per block = {100,500,300} → sorted 100,300,500
    assert.deepEqual(a.paidPerBlock, {
      avg: "300", // (100+300+500)/3
      median: "300",
      min: "100",
      max: "500",
    });
    // base 0 → tips == paid, same distribution
    assert.deepEqual(a.tipsPerBlock, {
      avg: "300",
      median: "300",
      min: "100",
      max: "500",
    });
  });

  it("median averages the two middles for an even block count", () => {
    const blocks = [100n, 200n, 300n, 400n].map((eff, i) =>
      computeBlock(
        {
          number: BigInt(i),
          timestamp: 1,
          baseFeePerGas: 0n,
          gasUsed: 1n,
          gasLimit: 10n,
          miner: "0xm",
          txs: [tx(0, 2, "0xa", 1n, eff)],
        },
        { burnsBaseFee: true },
      ),
    );
    // sorted 100,200,300,400 → median (200+300)/2 = 250
    assert.equal(aggregateWindow(blocks).paidPerBlock.median, "250");
  });

  it("pools sums and reports oldest→newest range (newest-first input)", () => {
    const newer = computeBlock(
      { ...workedBlock(), number: 1001n, timestamp: 1_700_000_010 },
      { burnsBaseFee: true },
    );
    const older = computeBlock(
      { ...workedBlock(), number: 1000n, timestamp: 1_700_000_000 },
      { burnsBaseFee: true },
    );
    // cache hands windows newest-first
    const a = aggregateWindow([newer, older]);
    assert.equal(a.blocksAnalyzed, 2);
    assert.equal(a.fromBlock, "1000");
    assert.equal(a.toBlock, "1001");
    assert.equal(a.fromTimestamp, 1_700_000_000);
    assert.equal(a.toTimestamp, 1_700_000_010);
    // sums double
    assert.equal(a.paid, "182000");
    assert.equal(a.burned, "80000");
    // pooled gas-weighted: (100+100) ooo / (400+400) comparable = 0.25
    assert.equal(a.priorityInversionRate, 0.25);
    assert.equal(a.legacyGasShare, 0.5);
  });
});
