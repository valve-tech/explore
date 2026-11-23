import { Icon } from "@iconify/react";
import { Link } from "react-router-dom";
import { RELATIONS, type AddressRelation } from "../../../lib/addressRelations";
import { scanPath } from "../../../lib/scanRoutes";
import { useActiveChainId } from "../../../lib/activeChain";
import { Tooltip } from "../../primitives/Tooltip";

/**
 * One fixed strip of icons per row: a lit icon is a way the page's address
 * takes part in the transaction, a dim one is a way it does not. The strip
 * links to the transaction with `?for=`, which opens a section naming every
 * place the address appears — the answer for a "trace only" row.
 */
export function RelationIcons({
  relations,
  hash,
  ownerAddress,
}: {
  relations: AddressRelation[] | undefined;
  hash: string;
  ownerAddress: string;
}) {
  const chainId = useActiveChainId();
  if (!relations) return null;
  const lit = new Set(relations);
  const summary =
    relations.length === 0
      ? "The server could not tell how this address takes part. Open the transaction to see."
      : RELATIONS.filter((r) => lit.has(r.kind))
          .map((r) => r.description)
          .join(" ");
  return (
    <Tooltip label={<span className="block max-w-72">{summary}</span>}>
      <Link
        to={`${scanPath("tx", hash, chainId)}?for=${ownerAddress}`}
        aria-label={`How this address takes part: ${
          relations.length === 0 ? "unknown" : relations.join(", ")
        }`}
        className="inline-flex items-center gap-0.5 cursor-pointer"
        data-testid="relation-icons"
      >
        {RELATIONS.map((r) => (
          <span key={r.kind} data-kind={r.kind} data-lit={lit.has(r.kind) ? "true" : "false"}>
            <Icon
              icon={r.icon}
              className={`w-3.5 h-3.5 ${lit.has(r.kind) ? "theme-accent" : "theme-text-muted opacity-30"}`}
            />
          </span>
        ))}
      </Link>
    </Tooltip>
  );
}
