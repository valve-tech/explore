import type { Page } from "@playwright/test";
import type {
  AddressTransaction,
  TransactionDetails,
  TransactionDecode,
} from "../src/api/explorer";

// ---------------------------------------------------------------------------
// Shared fixture values
// ---------------------------------------------------------------------------
//
// None of these are real on-chain values — every backend call the stubbed
// pages make is intercepted below, so nothing here ever needs to resolve
// against a live chain. Fixed length/shape is what matters: 42-char
// addresses and 66-char (0x + 64 hex) hashes so MiddleTruncate cells render
// exactly as they do in production (two child spans, CSS-clipped), not as a
// short placeholder that happens to fit.

export const FROM_ADDRESS = "0x1111111111111111111111111111111111111111";
export const TO_ADDRESS = "0x2222222222222222222222222222222222222222";
export const TOKEN_ADDRESS = "0x4444444444444444444444444444444444444444";
export const MINER_ADDRESS = "0x5555555555555555555555555555555555555555";

export const FULL_TX_HASH =
  "0x3333333333333333333333333333333333333333333333333333333333333333".slice(
    0,
    66,
  );
const BLOCK_TX_HASH =
  "0x8888888888888888888888888888888888888888888888888888888888888888".slice(
    0,
    66,
  );
export const BLOCK_HASH =
  "0x6666666666666666666666666666666666666666666666666666666666666666".slice(
    0,
    66,
  );
const PARENT_HASH =
  "0x7777777777777777777777777777777777777777777777777777777777777777".slice(
    0,
    66,
  );

export const BLOCK_NUMBER = "12345";
const BLOCK_NUMBER_HEX = `0x${Number(BLOCK_NUMBER).toString(16)}`;

// ---------------------------------------------------------------------------
// Address page — GET/POST calls fired by AddressView.tsx on mount (see
// `packages/web/src/components/explorer/AddressView.tsx`'s
// `Promise.all([fetchAddressInfo, fetchAddressTransactions, fetchAddressTokens,
// fetchHoldings])` effect). Matched by exact pathname + query param rather
// than a glob, since `/api` is a single dispatcher path disambiguated by
// `module`/`action` query params (see `packages/web/src/api/explorer.ts`).
// ---------------------------------------------------------------------------

const FIXTURE_ADDRESS_TX: AddressTransaction = {
  hash: FULL_TX_HASH,
  blockNumber: BLOCK_NUMBER,
  timeStamp: String(Math.floor(Date.now() / 1000) - 60),
  from: FROM_ADDRESS,
  to: TO_ADDRESS,
  value: "1000000000000000000",
  valuePLS: "1",
  gas: "21000",
  gasUsed: "21000",
  gasPrice: "1000000000",
  isError: "0",
  functionName: "",
  methodId: "0x",
  input: "0x",
  type: "0",
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
};

/** Stub every network call `AddressView` fires so `/address/:addr` reaches
 *  its loaded (populated) state with zero backend involvement. */
export async function stubAddressEndpoints(
  page: Page,
  address: string = FROM_ADDRESS,
): Promise<void> {
  // fetchAddressInfo -> readAddressViaDispatcher: two parallel dispatcher
  // reads, `module=account&action=balance` and `module=proxy&action=eth_getCode`.
  await page.route(
    (url) => url.pathname === "/api" && url.searchParams.get("action") === "balance",
    (route) => route.fulfill({ json: { status: "1", message: "OK", result: "0" } }),
  );
  await page.route(
    (url) => url.pathname === "/api" && url.searchParams.get("action") === "eth_getCode",
    (route) =>
      route.fulfill({ json: { jsonrpc: "2.0", id: 1, result: "0x" } }),
  );

  // fetchAddressTransactions -> GET /api/address/:addr/txs?page=&limit=
  // apiFetch() unwraps `{ ok, result }`; `result` is `{ transactions, total }`.
  await page.route(
    (url) => url.pathname === `/api/address/${address}/txs`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: { transactions: [{ ...FIXTURE_ADDRESS_TX, from: address }], total: 1 },
        },
      }),
  );

  // fetchAddressTokens -> GET /api/address/:addr/tokens
  await page.route(
    (url) => url.pathname === `/api/address/${address}/tokens`,
    (route) => route.fulfill({ json: { ok: true, result: [] } }),
  );

  // fetchHoldings -> GET /api/portfolio/holdings?address=. AddressView
  // `.catch(() => null)`s this one, but stub it too so the page reaches its
  // loaded state deterministically rather than depending on catch-path timing.
  await page.route(
    (url) => url.pathname === "/api/portfolio/holdings",
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            chainId: 369,
            address,
            native: { symbol: "PLS", balance: "0" },
            holdings: [],
            indexed: false,
          },
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Tx page — TxDetail.tsx fires `fetchTransaction(hash, chainId, {decode:
// false})` (GET /api/tx/:hash?decode=0) on mount, then `useTxDecode` fires a
// second, independent `fetchTransactionDecode` (GET /api/tx/:hash/decode) so
// the core payload can paint without waiting on a verified-source upstream.
// ---------------------------------------------------------------------------

const FIXTURE_TX_DETAILS: TransactionDetails = {
  hash: FULL_TX_HASH,
  blockNumber: BLOCK_NUMBER,
  blockHash: BLOCK_HASH,
  transactionIndex: 0,
  from: FROM_ADDRESS,
  to: TO_ADDRESS,
  value: "1000000000000000000",
  valuePLS: "1",
  gas: "21000",
  gasPrice: "1000000000",
  gasUsed: "21000",
  effectiveGasPrice: "1000000000",
  nonce: 1,
  input:
    "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222200000000000000000000000000000000000000000000000de0b6b3a7640000",
  status: "success",
  timestamp: Math.floor(Date.now() / 1000) - 60,
  decodedInput: null,
  decodedLogs: [],
  rawLogs: [
    {
      address: TOKEN_ADDRESS,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        `0x000000000000000000000000${FROM_ADDRESS.slice(2)}`,
        `0x000000000000000000000000${TO_ADDRESS.slice(2)}`,
      ],
      data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
      logIndex: 0,
    },
  ],
  internalTransactions: [
    {
      from: FROM_ADDRESS,
      to: TO_ADDRESS,
      value: "500000000000000000",
      valuePLS: "0.5",
      type: "CALL",
      gas: "21000",
      gasUsed: "21000",
      input: "0x",
      errCode: "",
      isError: "0",
    },
  ],
  tokenTransfers: [
    {
      from: FROM_ADDRESS,
      to: TO_ADDRESS,
      value: "1000000000000000000",
      tokenName: "Test Token",
      tokenSymbol: "TST",
      tokenDecimal: "18",
      contractAddress: TOKEN_ADDRESS,
      hash: FULL_TX_HASH,
    },
  ],
  contractAddress: null,
  cumulativeGasUsed: "21000",
  type: "2",
};

const FIXTURE_TX_DECODE: TransactionDecode = {
  decodedInput: {
    functionName: "transfer",
    args: [
      { name: "to", type: "address", value: TO_ADDRESS },
      { name: "amount", type: "uint256", value: "1000000000000000000" },
    ],
  },
  decodedLogs: [
    {
      eventName: "Transfer",
      args: [
        { name: "from", type: "address", value: FROM_ADDRESS },
        { name: "to", type: "address", value: TO_ADDRESS },
        { name: "value", type: "uint256", value: "1000000000000000000" },
      ],
      address: TOKEN_ADDRESS,
      logIndex: 0,
    },
  ],
};

/** Stub every network call `TxDetail` fires so `/tx/:hash` reaches its
 *  loaded (populated) state — core tx + decode. */
export async function stubTxEndpoints(
  page: Page,
  hash: string = FULL_TX_HASH,
  /**
   * Overrides merged onto the fixture. The next-steps rail branches on
   * `status` and the decoded function name, so a caller testing it needs to
   * vary those two without hand-rolling a whole TransactionDetails — an
   * incomplete one crashes the value formatter long before the rail renders.
   */
  overrides: Partial<TransactionDetails> = {},
  decodedFunctionName?: string,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/tx/${hash}`,
    (route) =>
      route.fulfill({
        json: { ok: true, result: { ...FIXTURE_TX_DETAILS, hash, ...overrides } },
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/tx/${hash}/decode`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: decodedFunctionName
            ? {
                ...FIXTURE_TX_DECODE,
                // The name lives under `decodedInput`, not at the top level —
                // TxDetail reads `decode.decodedInput?.functionName`.
                decodedInput: {
                  ...FIXTURE_TX_DECODE.decodedInput,
                  functionName: decodedFunctionName,
                },
              }
            : FIXTURE_TX_DECODE,
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Block page — BlockView.tsx fires `fetchBlock(numberOrHash, chainId)`,
// which (with no BYO-RPC override) reads via the Etherscan-shaped dispatcher:
// `module=proxy&action=eth_getBlockByNumber&tag=0x..&boolean=true` for a
// decimal/hex block number, or `eth_getBlockByHash` for a 66-char hash.
// ---------------------------------------------------------------------------

/** Stub the network call `BlockView` fires so `/block/:id` (numeric id)
 *  reaches its loaded (populated) state, including one populated tx row. */
export async function stubBlockEndpoints(
  page: Page,
  blockNumberHex: string = BLOCK_NUMBER_HEX,
): Promise<void> {
  await page.route(
    (url) =>
      url.pathname === "/api" &&
      url.searchParams.get("action") === "eth_getBlockByNumber",
    (route) =>
      route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            number: blockNumberHex,
            hash: BLOCK_HASH,
            parentHash: PARENT_HASH,
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
            miner: MINER_ADDRESS,
            gasUsed: "0x5208",
            gasLimit: "0x1c9c380",
            baseFeePerGas: "0x3b9aca00",
            size: "0x220",
            transactions: [
              {
                hash: BLOCK_TX_HASH,
                from: FROM_ADDRESS,
                to: TO_ADDRESS,
                value: "0xde0b6b3a7640000",
                gasPrice: "0x3b9aca00",
                type: "0x2",
                input:
                  "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222200000000000000000000000000000000000000000000000de0b6b3a7640000",
              },
            ],
          },
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Token page — `/token/:address` renders `ContractView`, which fires
// `fetchContractInfo(address, chainId)` (GET /api/contract/:address).
// ---------------------------------------------------------------------------

/** Stub the network call `ContractView` fires so `/token/:address` reaches
 *  its loaded (populated) state — a verified contract with a read function. */
export async function stubTokenEndpoints(
  page: Page,
  address: string = TOKEN_ADDRESS,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/contract/${address}`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            address,
            isVerified: true,
            contractName: "TestToken",
            compilerVersion: "0.8.19+commit.7dd6d404",
            optimizationUsed: true,
            sourceCode: "// SPDX-License-Identifier: MIT\ncontract TestToken {}",
            abi: [
              {
                type: "function",
                name: "balanceOf",
                stateMutability: "view",
                inputs: [{ name: "account", type: "address" }],
                outputs: [{ name: "", type: "uint256" }],
              },
              {
                type: "function",
                name: "transfer",
                stateMutability: "nonpayable",
                inputs: [
                  { name: "to", type: "address" },
                  { name: "amount", type: "uint256" },
                ],
                outputs: [{ name: "", type: "bool" }],
              },
            ],
            constructorArguments: "0x",
            evmVersion: "paris",
            library: "",
            licenseType: "MIT",
            proxy: "0",
            implementation: "",
            swarmSource: "",
          },
        },
      }),
  );
}

// ---------------------------------------------------------------------------
// Chain-agnostic multichain endpoints — fired by MultiChainAddressView and
// BlockHeightView, which is what an UNSCOPED `/address/:a`, `/token/:a`, and
// `/block/:n` render. A chain-scoped URL (`/eip155/369/address/:a`) renders
// the single-chain views instead and needs the stubs above, not these.
//
// Shapes mirror `packages/web/src/api/multichain.ts`: the client unwraps
// `{ ok, result }`, presence lives under `result.chains`, and merged activity
// is `{ rows, perChain }`.
// ---------------------------------------------------------------------------

/** Two chains present, two absent — the mixed case the strip has to lay out. */
export async function stubMultichainAddressEndpoints(
  page: Page,
  address: string = FROM_ADDRESS,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/multichain/address/${address}`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            address,
            chains: [
              { chainId: 1, balance: "99983185134319660", nonce: 1, isContract: false },
              { chainId: 369, balance: "1642096148399697982849068301", nonce: 35, isContract: false },
              { chainId: 943, balance: "0", nonce: 0, isContract: false },
              { chainId: 11155111, balance: "0", nonce: 0, isContract: false },
            ],
          },
        },
      }),
  );

  await page.route(
    (url) => url.pathname === `/api/multichain/address/${address}/activity`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            address,
            // A full-length hash and a real function signature, so the row's
            // main line and subline are as wide here as in production.
            rows: [
              {
                chainId: 369,
                hash: FULL_TX_HASH,
                timeStamp: String(Math.floor(Date.now() / 1000) - 60),
                blockNumber: BLOCK_NUMBER,
                from: address,
                to: TO_ADDRESS,
                value: "0",
                functionName: "multicall(uint256,bytes[])",
              },
              {
                chainId: 1,
                hash: BLOCK_HASH,
                timeStamp: String(Math.floor(Date.now() / 1000) - 3600),
                blockNumber: BLOCK_NUMBER,
                from: TO_ADDRESS,
                to: address,
                value: "1000000000000000000",
                functionName: "",
              },
            ],
            perChain: [
              { chainId: 1, returned: 1 },
              { chainId: 369, returned: 1 },
            ],
          },
        },
      }),
  );
}

/** One chain has reached the height, one has not, one errored. */
export async function stubMultichainBlockEndpoints(
  page: Page,
  height: string = BLOCK_NUMBER,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/multichain/block/${height}`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            height,
            chains: [
              {
                chainId: 1,
                reached: true,
                head: 21000000,
                hash: BLOCK_HASH,
                txCount: 1,
                gasUsed: "21000",
                gasLimit: "30000000",
                timestamp: Math.floor(Date.now() / 1000) - 120,
              },
              { chainId: 369, reached: false, head: 100 },
              { chainId: 943, reached: true, head: 21000000, hash: BLOCK_HASH, txCount: 0, gasUsed: "0", gasLimit: "30000000", timestamp: Math.floor(Date.now() / 1000) - 300 },
              { chainId: 11155111, reached: false, error: true },
            ],
          },
        },
      }),
  );
}
