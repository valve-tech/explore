import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A cross / close mark (`✕`). Inherits `currentColor`. */
export function XIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}
