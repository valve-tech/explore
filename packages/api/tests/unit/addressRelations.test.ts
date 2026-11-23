import { test } from "node:test";
import assert from "node:assert/strict";
import { addressRelations } from "../../src/services/explorer/addresses/relations.js";

/*
 * Fixture: chain 1 tx 0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8
 * (https://explore.valve.city/#/eip155/1/tx/0x7fb3925046709b47703375493d7b64c3401c00199fa59a533e1e130c4dcc63d8),
 * an Omnibridge safeExecuteSignaturesWithAutoGasLimit. The bridge validator
 * 0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E appears ONLY in the trace: an
 * ecrecover returns it and isValidator(address) takes it as an argument.
 */
const TX = {
  from: "0xe3c31dd2605bf50bfd4bbb39b5a84041aaa38695",
  to: "0xd0764fae29e0a6a96ff685f71cfc685456d5636c",
  input: "0x23caab490000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000b600050000eb21bb7b72d1042c471c6a52c971da8152d66d7a0000000000080a404fd0aaa7506f3d9cb8274bdb946ec42a1b8751ef1715a3e4a142d8b698131108995174f37aeba10d001e8480020100017101272255bb0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f000000000000000000000000e3c31dd2605bf50bfd4bbb39b5a84041aaa3869500000000000000000000000000000000000000000000000029a59650af9aa000000000000000000000000000000000000000000000000000000000000000000000000000000000000146051b1c1c1c1c18e8eaf96fbb7f3a1599c6b5a4b3477740846e3eb7ad9350c2f93c1c48bd89d4d4ef430b1252c8d676f1710f10613604db6ab18bcf7f9b9a22e4fc85fc294b728cd28b8a2452f7f16a0240d45a61e8f6dddc7eeed07f716c9ca31f101e41ae8b72112a47227e21862b6dcc1c63ed34683cc0f6d51a8a7fc0c544bf09a4c5d870e83900475bf9b8a74e84069c09ab7908f22178eb49b7a947da8bb39844a5d1633f65b9d1ecfcc7614a3a1b8c314473958acf47f45d1930c687baa21ac0a77b573c20cf53069925ba7ce8749c9537905ad9d4ab7d6fda01aa59e2ccb0d61eff2932a79e0fb3dd5b63f565ea5ba9d9dbcaef4e685a5bd5a80ac204b281cadcb73562e7b121a7f653e810987d2820f2c457c2c28399126d65d22ba49bf3cf10dfe75798605a8c55ffecb949589b417f26804aad82e5ac180d91559d137841f1f95b0000000000000000000000000000000000000000000000000000",
};
const RECEIPT = {
  contractAddress: null,
  logs: [
    {
      "address": "0x6b175474e89094c44da98b954eedeac495271d0f",
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000001715a3e4a142d8b698131108995174f37aeba10d",
        "0x000000000000000000000000e3c31dd2605bf50bfd4bbb39b5a84041aaa38695"
      ],
      "data": "0x00000000000000000000000000000000000000000000000029a59650af9aa000"
    },
    {
      "address": "0x1715a3e4a142d8b698131108995174f37aeba10d",
      "topics": [
        "0x9afd47907e25028cdaca89d193518c302bbb128617d5a992c5abd45815526593",
        "0x0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f",
        "0x000000000000000000000000e3c31dd2605bf50bfd4bbb39b5a84041aaa38695",
        "0x00050000eb21bb7b72d1042c471c6a52c971da8152d66d7a0000000000080a40"
      ],
      "data": "0x00000000000000000000000000000000000000000000000029a59650af9aa000"
    },
    {
      "address": "0xd0764fae29e0a6a96ff685f71cfc685456d5636c",
      "topics": [
        "0x27333edb8bdcd40a0ae944fb121b5e2d62ea782683946654a0f5e607a908d578",
        "0x0000000000000000000000004fd0aaa7506f3d9cb8274bdb946ec42a1b8751ef",
        "0x0000000000000000000000001715a3e4a142d8b698131108995174f37aeba10d",
        "0x00050000eb21bb7b72d1042c471c6a52c971da8152d66d7a0000000000080a40"
      ],
      "data": "0x0000000000000000000000000000000000000000000000000000000000000001"
    }
  ],
};

test("a validator seen only in the trace is classified as trace", () => {
  assert.deepEqual(
    addressRelations("0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E", TX, RECEIPT),
    ["trace"],
  );
});

test("the sender who also receives DAI is sender, calldata, token and event", () => {
  // 0xe3c3… sent the tx, is named in its call data, receives the DAI Transfer
  // (log 230), and is a topic of the bridge's TokensBridged log (231).
  assert.deepEqual(addressRelations(TX.from, TX, RECEIPT), [
    "sender",
    "calldata",
    "token",
    "event",
  ]);
});

test("the called bridge contract is recipient and event (it emits log 232)", () => {
  assert.deepEqual(addressRelations(TX.to, TX, RECEIPT), ["recipient", "event"]);
});

test("the token contract that emits the Transfer is an event emitter", () => {
  // DAI is named in the call data too, so both apply.
  assert.deepEqual(
    addressRelations("0x6B175474E89094C44Da98b954EedeAC495271d0F", TX, RECEIPT),
    ["calldata", "event"],
  );
});

test("a created contract is creation, and matching ignores case", () => {
  const tx = { from: "0x" + "a".repeat(40), to: null, input: "0x" };
  const receipt = { contractAddress: "0x" + "B".repeat(40), logs: [] };
  assert.deepEqual(addressRelations("0x" + "b".repeat(40), tx, receipt), ["creation"]);
});

test("a missing receipt with no visible match is unknown, not trace", () => {
  assert.deepEqual(
    addressRelations("0x5ECfE77502317F3677f23C3b8Ab17929ACE3D74E", TX, null),
    [],
  );
});

test("a selector never counts as call data", () => {
  const owner = "0x" + "1".repeat(40);
  const tx = { from: "0x" + "2".repeat(40), to: "0x" + "3".repeat(40), input: "0x11111111" };
  assert.deepEqual(addressRelations(owner, tx, { logs: [] }), ["trace"]);
});
