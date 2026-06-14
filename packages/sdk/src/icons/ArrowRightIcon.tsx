import { Svg } from "./Svg.js";
import type { IconProps } from "./types.js";

/** A rightward arrow (`→`). Inherits `currentColor`. */
export function ArrowRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}
