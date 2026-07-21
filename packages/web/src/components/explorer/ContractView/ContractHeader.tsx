import type { ContractInfo } from "../../../api/explorer";
import { TokenImage } from "../../primitives/TokenImage";
import { EntityActionBar } from "../../EntityActionBar";
import { AddToWorkspaceButton } from "../../workspace/AddToWorkspaceButton";

export function ContractHeader({
  address,
  info,
  onViewAddress,
}: {
  address: string;
  info: ContractInfo;
  onViewAddress: () => void;
}) {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-row justify-between">
        <div className="flex items-center gap-row min-w-0">
          <TokenImage address={address} symbol={info.contractName ?? undefined} size={36} />
          <div className="min-w-0">
          <div className="flex items-center gap-inline mb-1">
            <h2
              className="text-sm font-semibold theme-text"
            >
              Contract
            </h2>
            {info.isVerified ? (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider theme-success-bg theme-success"
              >
                Verified
              </span>
            ) : (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider theme-warning-bg theme-warning"
              >
                Unverified
              </span>
            )}
          </div>
          <span
            className="font-mono text-sm break-all theme-text"
          >
            {address}
          </span>
          {info.contractName && (
            <div className="mt-1">
              <span
                className="text-xs theme-text-secondary"
              >
                {info.contractName}
              </span>
              {info.compilerVersion && (
                <span
                  className="text-xs ml-2 theme-text-muted"
                >
                  ({info.compilerVersion})
                </span>
              )}
            </div>
          )}
          <div className="mt-3 flex items-center gap-inline flex-wrap">
            <EntityActionBar kind="contract" value={address} omit={["explorer"]} />
            <AddToWorkspaceButton kind="address" value={address} />
          </div>
          </div>
        </div>
        <button
          onClick={onViewAddress}
          className="text-xs font-medium hover:underline cursor-pointer shrink-0 theme-accent"
        >
          View Address
        </button>
      </div>
    </div>
  );
}
