import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A checkmark (`✓`). Inherits `currentColor`. */
export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}
