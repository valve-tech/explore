import type { ReactNode } from "react";
import type { IconProps } from "./types.js";

interface SvgProps extends IconProps {
  /** Path / shape children rendered inside the 24×24 viewBox. */
  children: ReactNode;
}

/**
 * Internal base used by every default icon. Centralizes sizing, the
 * stroke-inherits-`currentColor` setup, and the decorative-vs-labeled a11y
 * branch so individual icon files stay a single `<path>`.
 *
 * Not part of the public API — consumers import the named icons instead.
 */
export function Svg({
  size = 16,
  className,
  style,
  title,
  children,
}: SvgProps): React.JSX.Element {
  const labelled = title !== undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {labelled ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
