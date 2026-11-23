/**
 * Word tables for the Solidity and Yul tokenizer. Data only.
 */

/** Reserved words. Each one is a keyword in every position except after a dot. */
export const SOLIDITY_KEYWORDS = new Set([
  "pragma", "import", "as", "contract", "interface", "library", "abstract",
  "function", "modifier", "event", "struct", "enum", "mapping", "type",
  "public", "private", "internal", "external", "view", "pure", "payable",
  "returns", "return", "if", "else", "for", "while", "do", "break", "continue",
  "emit", "new", "delete", "is", "using", "indexed", "anonymous",
  "memory", "storage", "calldata", "immutable", "constant", "override", "virtual",
  "constructor", "try", "catch", "assembly", "unchecked",
  "true", "false", "this", "super", "throw", "var",
]);

/** Keywords that open a declaration of a callable name. */
export const CALLABLE_DECLARATORS = new Set(["function", "modifier", "event", "error"]);

/** Names the compiler provides. They have no declaration in user source. */
export const SOLIDITY_BUILTINS = new Set([
  "msg", "tx", "block", "abi", "now",
  "require", "assert",
  "keccak256", "sha256", "sha3", "ripemd160", "ecrecover",
  "addmod", "mulmod", "blockhash", "blobhash", "gasleft", "selfdestruct", "suicide",
]);

/** Denomination and time units. A unit is valid only after a number literal. */
export const NUMBER_UNITS = new Set([
  "wei", "gwei", "ether", "szabo", "finney",
  "seconds", "minutes", "hours", "days", "weeks", "years",
]);

const SIZED_INT_RE = /^u?int(\d+)$/;
const SIZED_BYTES_RE = /^bytes(\d+)$/;
const SIZED_FIXED_RE = /^u?fixed(\d+)x(\d+)$/;
const PLAIN_TYPES = new Set([
  "uint", "int", "bytes", "string", "bool", "address", "fixed", "ufixed",
]);

/** True for an elementary type name: uint8..uint256, bytes1..bytes32, ... */
export function isElementaryType(word: string): boolean {
  if (PLAIN_TYPES.has(word)) return true;
  const int = SIZED_INT_RE.exec(word);
  if (int) {
    const bits = Number(int[1]);
    return bits >= 8 && bits <= 256 && bits % 8 === 0;
  }
  const bytes = SIZED_BYTES_RE.exec(word);
  if (bytes) {
    const size = Number(bytes[1]);
    return size >= 1 && size <= 32 && !bytes[1]!.startsWith("0");
  }
  const fixed = SIZED_FIXED_RE.exec(word);
  if (fixed) {
    const bits = Number(fixed[1]);
    return bits >= 8 && bits <= 256 && bits % 8 === 0 && Number(fixed[2]) <= 80;
  }
  return false;
}

export const YUL_KEYWORDS = new Set([
  "let", "if", "switch", "case", "default", "for", "function",
  "leave", "break", "continue", "true", "false",
]);

/** EVM dialect builtins. A Yul name cannot shadow one of these. */
export const YUL_BUILTINS = new Set([
  "stop", "add", "sub", "mul", "div", "sdiv", "mod", "smod", "exp", "not",
  "lt", "gt", "slt", "sgt", "eq", "iszero", "and", "or", "xor", "byte",
  "shl", "shr", "sar", "addmod", "mulmod", "signextend", "keccak256",
  "pc", "pop", "mload", "mstore", "mstore8", "sload", "sstore", "tload", "tstore",
  "msize", "gas", "address", "balance", "selfbalance", "caller", "callvalue",
  "calldataload", "calldatasize", "calldatacopy", "codesize", "codecopy",
  "extcodesize", "extcodecopy", "returndatasize", "returndatacopy", "mcopy",
  "extcodehash", "create", "create2", "call", "callcode", "delegatecall",
  "staticcall", "return", "revert", "selfdestruct", "invalid",
  "log0", "log1", "log2", "log3", "log4",
  "chainid", "basefee", "blobbasefee", "origin", "gasprice", "blockhash",
  "blobhash", "coinbase", "timestamp", "number", "difficulty", "prevrandao",
  "gaslimit",
  "datasize", "dataoffset", "datacopy", "setimmutable", "loadimmutable",
  "linkersymbol", "memoryguard", "verbatim",
]);
