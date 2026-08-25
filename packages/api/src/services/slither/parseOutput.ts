import type { SlitherFinding } from "./types.js";

interface RawSlitherDetector {
  check: string;
  impact: string;
  confidence: string;
  description: string;
  elements: Array<{
    type: string;
    name: string;
    source_mapping?: {
      start: number;
      length: number;
      filename_relative: string;
      lines: number[];
    };
  }>;
  first_markdown_element?: string;
  markdown?: string;
}

interface RawSlitherOutput {
  success: boolean;
  error: string | null;
  results?: { detectors?: RawSlitherDetector[] };
}

/**
 * Extract findings from Slither's JSON output.
 *
 * Returns `null` when the output cannot be read, and `[]` only when Slither
 * ran and reported nothing. The two used to collapse into `[]`, which the
 * caller published as `detectorCount: 0, error: null` — a clean bill of
 * health for a contract nobody analysed. "Slither found no issues" is a
 * claim about the contract; "Slither did not produce readable output" is a
 * claim about our server, and the reader must not be shown the first when
 * the second is true.
 *
 * Three signals separate them, and all three come from Slither itself:
 * no `{` in stdout, JSON that will not parse, and a payload whose own
 * `success` / `error` fields say the run failed. A clean contract emits
 * valid JSON with `results.detectors: []`, so a real empty stays empty.
 *
 * Slither sometimes prints a non-JSON prelude (solc-select status, version
 * banners) before the JSON object, so we slice from the first `{` rather
 * than parsing the whole stdout.
 *
 * Source mapping is renamed `source_mapping → sourceMapping` to match
 * the rest of the wire surface (camelCase). Other fields keep their
 * Slither names where they're already markdown-prefixed
 * (`first_markdown_element`, `markdown`) to avoid breaking consumers
 * that pattern-match on those.
 */
export function parseSlitherOutput(stdout: string): SlitherFinding[] | null {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) return null;

  let parsed: RawSlitherOutput;
  try {
    parsed = JSON.parse(stdout.slice(jsonStart)) as RawSlitherOutput;
  } catch {
    return null;
  }

  if (isFailedSlitherRun(parsed)) return null;

  try {
    if (!parsed.results?.detectors) return [];

    return parsed.results.detectors.map((d) => ({
      check: d.check,
      impact: d.impact as SlitherFinding["impact"],
      confidence: d.confidence as SlitherFinding["confidence"],
      description: d.description,
      elements: d.elements.map((e) => ({
        type: e.type,
        name: e.name,
        sourceMapping: e.source_mapping
          ? {
              start: e.source_mapping.start,
              length: e.source_mapping.length,
              filename_relative: e.source_mapping.filename_relative,
              lines: e.source_mapping.lines,
            }
          : undefined,
      })),
      first_markdown_element: d.first_markdown_element,
      markdown: d.markdown,
    }));
  } catch {
    // The payload parsed but does not have the shape we map. That is still
    // "no readable output", not "no findings".
    return null;
  }
}

/**
 * True when Slither's own JSON says the run failed. Slither reports this in
 * its envelope — `success: false` and/or a non-null `error` — while still
 * emitting well-formed JSON, so a parse alone will not catch it.
 *
 * `success` is only trusted when it is actually a boolean: an older Slither
 * that omits the field must not be read as a failure.
 */
export function isFailedSlitherRun(parsed: {
  success?: boolean;
  error?: string | null;
}): boolean {
  return parsed.success === false || Boolean(parsed.error);
}
