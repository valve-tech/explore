import { type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { caip2ToChainId } from "../../lib/chains";

/**
 * The `/{namespace}/{reference}/…` subtree.
 *
 * Validates the CAIP-2 pair against the registry before rendering anything. An
 * unserved namespace or an unregistered reference renders a message rather than
 * falling through to the unscoped tree — falling through would render the page
 * against the default chain and quietly answer a question nobody asked.
 *
 * Children read the resolved chain through `useActiveChainId`, which parses the
 * same prefix. There is no context to thread, and deliberately so: one parser,
 * one answer.
 */
export default function ChainScopedRoutes({
  namespace,
  children,
}: {
  namespace: string;
  children: ReactNode;
}) {
  const { ref = "" } = useParams<{ ref: string }>();
  const chainId = caip2ToChainId(namespace, ref);

  if (chainId === undefined) {
    return (
      <div className="p-2 sm:p-4 shadow-[0_0_0_1px_var(--color-border-default)]">
        <p className="theme-text">Unsupported chain</p>
        <p className="theme-text-secondary theme-mono text-sm">
          {namespace}/{ref} is not a chain Explore serves.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
