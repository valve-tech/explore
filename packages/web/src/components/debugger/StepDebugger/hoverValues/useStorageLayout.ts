import { useQuery } from "@tanstack/react-query";
import { scoped } from "../../../../api/chainScope";
import { apiUrl } from "../../../../lib/apiBase";
import type { HoverStorageLayout } from "./layoutTypes";

interface LayoutResponse {
  ok: boolean;
  source?: "compiled" | "decompiled";
  storageLayout?: HoverStorageLayout;
  contractName?: string;
  error?: string;
}

export interface StorageLayoutResult {
  /** The solc layout. Null while loading, and for a contract without one. */
  layout: HoverStorageLayout | null;
  /** The contract the layout was compiled for. */
  contractName: string | null;
  isLoading: boolean;
}

/**
 * The storage layout of the CODE at `codeAddress` on chain `chainId`.
 *
 * For a proxy call, pass the IMPLEMENTATION address: the layout describes the
 * code that runs. The values come from the proxy's storage; frameStorageAt()
 * handles that part.
 *
 * The query key and the response shape are the same as in
 * StorageLayoutViewer.tsx, so the two share one cache entry. The chain id is
 * in the key: one address holds different code on different chains.
 */
export function useStorageLayout(
  codeAddress: string | null | undefined,
  chainId: number,
): StorageLayoutResult {
  const addr = codeAddress?.toLowerCase() ?? "";
  const { data, isLoading } = useQuery({
    queryKey: ["storage-layout", chainId, addr],
    queryFn: async (): Promise<LayoutResponse> => {
      const res = await fetch(scoped(apiUrl(`/api/source/${codeAddress}/storage-layout`), chainId));
      return (await res.json()) as LayoutResponse;
    },
    enabled: /^0x[0-9a-f]{40}$/.test(addr),
    staleTime: Infinity,
  });
  // A decompiled layout has no names and no types; it cannot answer a hover.
  const layout = data?.source !== "decompiled" && data?.storageLayout ? data.storageLayout : null;
  return { layout, contractName: layout ? data?.contractName ?? null : null, isLoading };
}
