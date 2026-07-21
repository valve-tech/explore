import type { AddressInfo } from "../../../api/explorer";
import { formatPLS } from "../format";
import { EntityActionBar } from "../../EntityActionBar";
import { AddToWorkspaceButton } from "../../workspace/AddToWorkspaceButton";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";

export function AddressHeader({
  address,
  info,
  onViewContract,
}: {
  address: string;
  info: AddressInfo | null;
  onViewContract: () => void;
}) {
  const symbol = chainSymbol(useActiveChainId());
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-row">
        <div>
          <div className="flex items-center gap-inline mb-1">
            <h2
              className="text-sm font-semibold theme-text"
            >
              Address
            </h2>
            {info?.isContract && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider theme-accent-bg theme-accent"
              >
                Contract
              </span>
            )}
          </div>
          <span
            className="font-mono text-sm break-all theme-text"
          >
            {address}
          </span>
          <div className="mt-3 flex items-center gap-inline flex-wrap">
            <EntityActionBar
              kind={info?.isContract ? "contract" : "address"}
              value={address}
              omit={["explorer"]}
            />
            <AddToWorkspaceButton kind="address" value={address} />
          </div>
        </div>
        <div className="text-right">
          <span
            className="text-xs block mb-0.5 theme-text-secondary"
          >
            Balance
          </span>
          <span
            className="font-mono text-lg font-semibold theme-text"
          >
            {info ? formatPLS(info.balancePLS, symbol) : "..."}
          </span>
        </div>
      </div>
      {info?.isContract && (
        <div
          className="mt-3 pt-3 bs-t-muted"
          style={{}}
        >
          <button
            onClick={onViewContract}
            className="text-xs font-medium hover:underline cursor-pointer theme-accent"
          >
            View Contract Details
          </button>
        </div>
      )}
    </div>
  );
}
