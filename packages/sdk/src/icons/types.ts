import type { CSSProperties } from "react";

/**
 * Shared props for the SDK's built-in inline-SVG icons.
 *
 * Every default icon is a pure, dependency-free functional component that
 * renders a single `<svg>`. Stroke/fill use `currentColor`, so an icon
 * inherits the surrounding text `color` unless overridden via `style`.
 */
export interface IconProps {
  /** Square edge length in px (sets both `width` and `height`). Default: 16. */
  size?: number;
  /** className forwarded to the root `<svg>`. */
  className?: string;
  /** Inline style forwarded to the root `<svg>`. */
  style?: CSSProperties;
  /**
   * Accessible label. When set, the icon exposes `role="img"` + a `<title>`;
   * when omitted, the icon is `aria-hidden` (decorative).
   */
  title?: string;
}
