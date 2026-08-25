/**
 * Barrel re-export for the explorer service. Implementation lives under
 * `services/explorer/` split by resource type. Consumers continue to
 * import from `./services/explorer.js` — no callsite changes when adding
 * new explorer endpoints.
 */

export { serialize } from "./explorer/client.js";
export {
  getTransactionDetails,
  buildTransactionDetails,
  type TransactionDetails,
} from "./explorer/transactionDetails.js";
export {
  getInternalTransactions,
  isTraceUnavailable,
  type InternalTransaction,
  type InternalTransactionsResult,
} from "./explorer/internalTransactions.js";
export {
  getTokenTransfers,
  isReceiptMissing,
  type TokenTransfer,
  type TokenTransfersResult,
} from "./explorer/tokenTransfers.js";
export {
  getAddressTransactions,
  getAddressTokens,
  getAddressBalance,
  isContract,
  type AddressTransaction,
  type AddressToken,
} from "./explorer/addresses.js";
export { getContractInfo, type ContractInfo } from "./explorer/contracts.js";
export { getBlockDetails, type BlockDetails } from "./explorer/blocks.js";
