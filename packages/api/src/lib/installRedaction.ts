/**
 * Imported second in index.ts, straight after env.js, so the redaction is in
 * place before any other module can log. See redactConsole.ts.
 */
import { installConsoleRedaction } from "./redactConsole.js";

installConsoleRedaction();
