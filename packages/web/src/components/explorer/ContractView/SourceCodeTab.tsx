import SourceViewer from "../../debugger/SoliditySourceViewer";

/** The flattened source starts with "// File: path.sol" when it has one. */
function sourceFileName(source: string): string {
  return /^\/\/ File: (\S+)/.exec(source)?.[1] ?? "source.sol";
}

function CodeBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="p-4 text-center text-sm theme-text-muted"
    >
      {message}
    </div>
  );
}

export function AbiTab({ abi }: { abi: unknown }) {
  return (
    <CodeBox>
      {abi ? (
        <div
          className="p-4 text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto theme-primary-bg theme-text"
        >
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(abi, null, 2)}
          </pre>
        </div>
      ) : (
        <EmptyState message="ABI not available (contract not verified)" />
      )}
    </CodeBox>
  );
}

export function SourceTab({ sourceCode }: { sourceCode: string | null }) {
  return (
    <CodeBox>
      {sourceCode ? (
        // The same viewer the debugger uses, so the explorer gets the same
        // highlighting. Read-only here: no step context, so no click handlers.
        <div className="h-[600px] theme-primary-bg">
          <SourceViewer
            file={{ name: sourceFileName(sourceCode), content: sourceCode }}
            currentLine={null}
          />
        </div>
      ) : (
        <EmptyState message="Source code not available (contract not verified)" />
      )}
    </CodeBox>
  );
}
