import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A down-pointing chevron (`⌄`). Inherits `currentColor`. */
export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}
