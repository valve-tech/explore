import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A left-pointing chevron (`‹`). Inherits `currentColor`. */
export function ChevronLeftIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m15 6-6 6 6 6" />
    </Svg>
  );
}
