import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import ChainScopedRoutes from "../components/routing/ChainScopedRoutes";
import LegacyChainParamRedirect from "../components/routing/LegacyChainParamRedirect";

function Probe() {
  const location = useLocation();
  return <div data-testid="url">{location.pathname + location.search}</div>;
}

/**
 * Always mounted, outside the <Routes> tree. `InnerRoutes` below intercepts
 * "/tx/…" with a real route, so the fallback `Probe` inside it never renders
 * for a tx path — this reads the URL directly instead of depending on which
 * route matched.
 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

/**
 * Stands in for the real `AppRoutes`. The static segments MUST live in this
 * inner <Routes>, exactly as they do in App.tsx — a harness that declares them
 * at the outer level tests a structure the app does not have, and hides the
 * ranking bug this file exists to catch.
 */
function InnerRoutes() {
  return (
    <Routes>
      <Route path="/settings" element={<div data-testid="hit">settings</div>} />
      <Route path="/workspace/:id" element={<div data-testid="hit">workspace</div>} />
      <Route path="/tx/:hash" element={<div data-testid="hit">tx</div>} />
      <Route path="/block/:id" element={<div data-testid="hit">block</div>} />
      <Route path="/drafts/*" element={<div data-testid="hit">drafts</div>} />
      <Route path="/*" element={<Probe />} />
    </Routes>
  );
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LegacyChainParamRedirect />
      <LocationProbe />
      <Routes>
        <Route
          path="/eip155/:ref/*"
          element={
            <ChainScopedRoutes namespace="eip155">
              <InnerRoutes />
            </ChainScopedRoutes>
          }
        />
        <Route path="/*" element={<InnerRoutes />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("route ranking", () => {
  it("gives a static two-segment route priority over the chain prefix", () => {
    renderAt("/workspace/abc");
    expect(screen.getByTestId("hit")).toHaveTextContent("workspace");
  });

  it("gives a static one-segment route priority", () => {
    renderAt("/settings");
    expect(screen.getByTestId("hit")).toHaveTextContent("settings");
  });

  it("gives the tx entity route priority over the chain prefix", () => {
    renderAt("/tx/0xabc");
    expect(screen.getByTestId("hit")).toHaveTextContent("tx");
  });

  it("gives a splat route priority over the chain prefix", () => {
    renderAt("/drafts/foo");
    expect(screen.getByTestId("hit")).toHaveTextContent("drafts");
  });
});

describe("ChainScopedRoutes", () => {
  it("renders the child tree for a served chain", () => {
    renderAt("/eip155/369/tx/0xabc");
    expect(screen.queryByText(/unsupported chain/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("hit")).toHaveTextContent("tx");
    expect(screen.getByTestId("loc")).toHaveTextContent("/eip155/369/tx/0xabc");
  });

  it("does not route an unserved namespace into the chain-scoped subtree", () => {
    // /eip155/:ref/* is the only chain-scoped route, so "bip122" never matches
    // it. The path falls through to the unscoped tree, which has no route for
    // it either, so it lands on InnerRoutes' own catch-all — not on
    // ChainScopedRoutes' "Unsupported chain" message.
    renderAt("/bip122/000000000019d6/tx/4a5e");
    expect(screen.queryByText(/unsupported chain/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("url")).toHaveTextContent("/bip122/000000000019d6/tx/4a5e");
  });

  it("renders not-found for an unregistered reference", () => {
    renderAt("/eip155/8453/tx/0xabc");
    expect(screen.getByText(/unsupported chain/i)).toBeInTheDocument();
  });
});

describe("LegacyChainParamRedirect", () => {
  it("rewrites ?chainid=N into the path form once", async () => {
    renderAt("/tx/0xabc?chainid=943");
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent("/eip155/943/tx/0xabc"),
    );
    expect(screen.getByTestId("loc")).not.toHaveTextContent("chainid");
  });

  it("preserves other query parameters while stripping chainid", async () => {
    renderAt("/tx/0xabc?chainid=1&tab=logs");
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("tab=logs"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/eip155/1/tx/0xabc");
  });

  it("does not fire when the path already carries a prefix", () => {
    renderAt("/eip155/369/tx/0xabc?chainid=1");
    // No rewrite: an explicit prefix wins and re-writing would loop.
    expect(screen.getByTestId("loc")).toHaveTextContent("chainid=1");
  });

  it("does not fire for an unregistered chainid", () => {
    renderAt("/tx/0xabc?chainid=8453");
    expect(screen.getByTestId("loc")).toHaveTextContent("/tx/0xabc?chainid=8453");
  });
});
