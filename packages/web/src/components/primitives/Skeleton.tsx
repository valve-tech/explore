/**
 * Loading placeholder block. A gently-pulsing muted rectangle (see `.skeleton`
 * in index.css) used to hold a section's shape while its data loads, so the
 * layout doesn't jump and stale numbers never flash. Size it with utility
 * classes (`h-*`, `w-*`); it's decorative, so it's hidden from assistive tech.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}
