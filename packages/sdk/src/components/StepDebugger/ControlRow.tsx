import type { ReactNode } from "react";
import type { useOpcodeNavigation } from "../../hooks/useOpcodeNavigation.js";

export function ControlRow({
  nav,
  empty,
  className,
  buttonClassName,
  prevIcon,
  nextIcon,
}: {
  nav: ReturnType<typeof useOpcodeNavigation>;
  empty: boolean;
  className?: string;
  buttonClassName?: string;
  prevIcon: ReactNode;
  nextIcon: ReactNode;
}) {
  const disableAll = empty;
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 16px",
        borderBottom: "1px solid rgba(139, 148, 158, 0.1)",
        flexWrap: "wrap",
      }}
    >
      <Button
        label="Prev"
        leadingIcon={prevIcon}
        title="Previous step (←)"
        onClick={nav.goBack}
        disabled={disableAll || !nav.canGoBack}
        className={buttonClassName}
      />
      <Button
        label="Next"
        trailingIcon={nextIcon}
        title="Next step (→)"
        onClick={nav.goForward}
        disabled={disableAll || !nav.canGoForward}
        className={buttonClassName}
      />
      <Button
        label="⇤ Start"
        title="Jump to start (Home)"
        onClick={() => nav.jumpTo(0)}
        disabled={disableAll || !nav.canGoBack}
        className={buttonClassName}
      />
      <Button
        label="End ⇥"
        title="Jump to end (End)"
        onClick={() => nav.jumpTo(nav.totalSteps - 1)}
        disabled={disableAll || !nav.canGoForward}
        className={buttonClassName}
      />
      <div style={{ flex: 1 }} />
      <Button
        label="Next CALL"
        title="Next CALL-family opcode (C)"
        onClick={nav.nextCall}
        disabled={disableAll}
        accent
        className={buttonClassName}
      />
      <Button
        label="Next SSTORE"
        title="Next storage-touching opcode (S)"
        onClick={nav.nextStorage}
        disabled={disableAll}
        accent
        className={buttonClassName}
      />
      <Button
        label="Next LOG"
        title="Next LOG opcode (L)"
        onClick={nav.nextLog}
        disabled={disableAll}
        accent
        className={buttonClassName}
      />
    </div>
  );
}

function Button({
  label,
  title,
  onClick,
  disabled,
  accent = false,
  className,
  leadingIcon,
  trailingIcon,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled: boolean;
  accent?: boolean;
  className?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        border: "1px solid rgba(139, 148, 158, 0.3)",
        backgroundColor: accent
          ? "rgba(99, 102, 241, 0.15)"
          : "rgba(0, 0, 0, 0.2)",
        color: accent ? "#6366f1" : "#c9d1d9",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {leadingIcon}
      {label}
      {trailingIcon}
    </button>
  );
}
