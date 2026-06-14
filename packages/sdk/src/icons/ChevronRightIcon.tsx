import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A right-pointing chevron (`›`). Inherits `currentColor`. */
export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}
