import { useState } from "react";
import { Icon } from "@iconify/react";
import { copyToClipboard } from "../../lib/clipboard";
import { Tooltip } from "./Tooltip";

/**
 * Copy-to-clipboard icon button with transient ✓ feedback. Replaces the copy
 * logic duplicated across TxRowActions, AddressRowActions, and the detail
 * headers. Stops propagation so it's safe inside clickable rows.
 */
export function CopyButton({
  value,
  title = "Copy",
  size = 26,
  className = "",
}: {
  value: string;
  title?: string;
  size?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    });
  };

  return (
    <Tooltip label={copied ? "Copied!" : title}>
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className={`inline-flex items-center justify-center transition-colors ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: "transparent",
          color: copied ? "var(--color-success)" : "var(--color-text-muted)",
        }}
      >
        <Icon
          icon={copied ? "heroicons:check" : "heroicons:clipboard-document"}
          className="w-3.5 h-3.5"
        />
      </button>
    </Tooltip>
  );
}
