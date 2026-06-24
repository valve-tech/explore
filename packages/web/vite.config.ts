import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // IPFS build: relative asset paths so the bundle loads under `/ipfs/<CID>/`.
  // Relative base is only safe with HashRouter (see main.tsx) — the canonical
  // BrowserRouter build keeps absolute "/" so nested routes resolve assets.
  base: process.env.VITE_IPFS ? "./" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The network-health analysis (compute + types) is PURE and is the single
      // source of truth in the API package. The BYO-RPC path computes it
      // client-side from the user's own node, so the web build imports those
      // exact files (no duplication, no drift). Vite resolves their internal
      // `./types.js` import to the `.ts` sibling, same as our own watcher code.
      "@networkHealth": new URL(
        "../api/src/services/networkHealth",
        import.meta.url,
      ).pathname,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Routes are lazy (React.lazy in App.tsx); what's left in the entry
        // is vendor weight that main.tsx needs eagerly (WagmiProvider +
        // persisted QueryClient). Split the big vendor groups so the entry
        // stays small and vendor chunks cache across app deploys.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // ox is viem's sibling crypto/ABI lib — keep them together.
          if (id.includes("/viem/") || id.includes("/ox/")) return "viem";
          if (id.includes("/wagmi/") || id.includes("/@wagmi/")) return "wagmi";
          if (id.includes("/@tanstack/")) return "query";
          if (
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 11800,
    host: true, // bind to 0.0.0.0 so the dev server is reachable from other devices on the LAN
    // Allow access via a cloudflared quick tunnel (random *.trycloudflare.com
    // host) so the dev server can be viewed off-box. localhost/LAN IPs are
    // always permitted regardless.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/health": {
        target: "http://localhost:10100",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:10100",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:10100",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      // Test scaffolding, type-only files, and the app entry are
      // excluded from the metric — they have no logic to cover.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/_test-utils.tsx",
        "src/test-setup.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
    },
  },
});
