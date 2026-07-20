import { defineConfig, devices } from "@playwright/test";

/**
 * Viewport-regression gate. Boots the Vite dev server and drives every route
 * at iPhone-SE width, asserting no page-level horizontal scroll. The API is
 * NOT required — routes must render their shell/empty state without a backend,
 * which is what we're measuring (layout, not data).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The address spec waits on real chain data (a live API + chifra round
  // trip); give it a bit of headroom beyond the 30s default.
  timeout: 45_000,
  use: {
    baseURL: "http://localhost:11800",
    // "iPhone SE" (bare) is 320×667 in this Playwright version's device list;
    // "iPhone SE (3rd gen)" is the 375×667 preset the brief calls for.
    ...devices["iPhone SE (3rd gen)"],
    // The iPhone SE device preset defaults to WebKit (real device match).
    // We only install the Chromium binary (per the brief — a single ~150MB
    // download, not the full browser matrix), so pin the engine explicitly;
    // the viewport/UA/touch emulation from the device preset are unaffected.
    browserName: "chromium",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:11800",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
