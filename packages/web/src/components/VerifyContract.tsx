import { apiUrl } from "../lib/apiBase";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isAddress } from "viem";

/**
 * Contract verification UI. Submits to the Etherscan-shaped dispatcher
 * (`module=contract&action=verifysourcecode`) which forwards the
 * standard-JSON-input payload to Sourcify and returns a GUID. We then
 * call `checkverifystatus` once — Sourcify is synchronous, so the
 * GUID-keyed result is ready immediately; we don't need a polling loop
 * the way Etherscan tooling does. The single check is kept for shape
 * parity with the tooling-side flow.
 *
 * v1 supports `solidity-standard-json-input` only — the modern
 * canonical format that hardhat/foundry/ethers tools all emit. Flat
 * single-file submissions would require fabricating a metadata.json
 * whose hash matches deploy-time solc output, which our backend
 * intentionally rejects to avoid producing fake "partial" matches.
 */

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "checking" }
  | { kind: "pass"; message: string }
  | { kind: "fail"; message: string };

const SAMPLE_JSON = `{
  "language": "Solidity",
  "sources": {
    "MyContract.sol": {
      "content": "// SPDX-License-Identifier: MIT\\npragma solidity ^0.8.20;\\ncontract MyContract { uint256 public x; }"
    }
  },
  "settings": {
    "optimizer": { "enabled": true, "runs": 200 }
  }
}`;

export default function VerifyContract() {
  const [searchParams] = useSearchParams();
  const [address, setAddress] = useState(() => searchParams.get("address") ?? "");
  const [compilerVersion, setCompilerVersion] = useState(
    "v0.8.20+commit.a1b79de6",
  );
  const [standardJson, setStandardJson] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const valid =
    isAddress(address) && compilerVersion.startsWith("v") && standardJson.trim().length > 0;

  const submit = async (): Promise<void> => {
    setStatus({ kind: "submitting" });
    try {
      const submitRes = await fetch(apiUrl("/api"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "contract",
          action: "verifysourcecode",
          contractaddress: address,
          codeformat: "solidity-standard-json-input",
          sourceCode: standardJson,
          compilerversion: compilerVersion,
        }),
      });
      const submitBody = (await submitRes.json()) as {
        status: string;
        result: string;
      };
      if (submitBody.status !== "1") {
        setStatus({ kind: "fail", message: submitBody.result });
        return;
      }
      const guid = submitBody.result;

      setStatus({ kind: "checking" });
      const checkRes = await fetch(
        apiUrl(`/api?module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`),
      );
      const checkBody = (await checkRes.json()) as {
        status: string;
        result: string;
      };
      if (checkBody.status === "1") {
        setStatus({ kind: "pass", message: checkBody.result });
      } else {
        setStatus({ kind: "fail", message: checkBody.result });
      }
    } catch (err) {
      setStatus({
        kind: "fail",
        message: err instanceof Error ? err.message : "Request failed",
      });
    }
  };

  const busy = status.kind === "submitting" || status.kind === "checking";

  return (
    <div className="space-y-stack max-w-3xl mx-auto">
      <header>
        <h1 className="text-xl font-semibold theme-text">Verify contract</h1>
        <p className="text-sm theme-text-muted mt-1">
          Submit Solidity source to Sourcify via our Etherscan-compatible
          endpoint. PulseChain (chain&nbsp;369) only.
        </p>
      </header>

      <div className="card p-2 sm:p-4 space-y-stack">
        <Field label="Contract address">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            placeholder="0x…"
            className="w-full px-2 py-1.5 text-sm theme-mono theme-input-bg theme-text bs-in-muted"
          />
        </Field>

        <Field
          label="Compiler version"
          help="Full solc commit tag, e.g. v0.8.20+commit.a1b79de6"
        >
          <input
            type="text"
            value={compilerVersion}
            onChange={(e) => setCompilerVersion(e.target.value.trim())}
            className="w-full px-2 py-1.5 text-sm theme-mono theme-input-bg theme-text bs-in-muted"
          />
        </Field>

        <Field
          label="Standard JSON input"
          help="solc --standard-json output (the `input` object)"
        >
          <textarea
            value={standardJson}
            onChange={(e) => setStandardJson(e.target.value)}
            placeholder={SAMPLE_JSON}
            rows={14}
            className="w-full px-2 py-1.5 text-xs theme-mono theme-input-bg theme-text bs-in-muted resize-y"
          />
        </Field>

        <div className="flex items-center gap-row">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || busy}
            className={`px-4 py-2 text-sm font-medium ${
              !valid || busy
                ? "theme-tertiary-bg theme-text-muted cursor-not-allowed"
                : "theme-accent-solid text-white hover:opacity-90"
            }`}
          >
            {status.kind === "submitting"
              ? "Submitting…"
              : status.kind === "checking"
                ? "Checking…"
                : "Verify"}
          </button>
          <StatusBadge status={status} />
        </div>
      </div>

      {status.kind === "pass" && (
        <div className="card p-2 sm:p-4 theme-success-bg">
          <h2 className="text-sm font-semibold theme-success">
            Verification succeeded
          </h2>
          <p className="text-sm theme-text-secondary mt-1">{status.message}</p>
        </div>
      )}

      {status.kind === "fail" && (
        <div className="card p-2 sm:p-4 theme-danger-bg">
          <h2 className="text-sm font-semibold theme-danger">
            Verification failed
          </h2>
          <p className="text-sm theme-text-secondary mt-1 theme-mono">
            {status.message}
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium theme-text-secondary uppercase tracking-wider">
          {label}
        </span>
        {help && <span className="text-xs theme-text-muted">{help}</span>}
      </div>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: Status }): React.ReactNode {
  if (status.kind === "idle") return null;
  if (status.kind === "submitting" || status.kind === "checking") {
    return (
      <span className="text-xs theme-text-muted">
        {status.kind === "submitting"
          ? "Forwarding to Sourcify…"
          : "Reading match result…"}
      </span>
    );
  }
  return null;
}
