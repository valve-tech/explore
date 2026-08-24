import { Link, Routes, Route } from "react-router-dom";
import { Icon } from "@iconify/react";
import JourneyDraft from "./JourneyDraft";
import WorkspaceDraft from "./WorkspaceDraft";

const DRAFTS = [
  {
    slug: "journey",
    title: "Tx Journey canvas",
    summary:
      "One tx hash, multiple lenses on a single page (decoded · trace · risks · state diff) plus a 'next step' rail that anticipates the next question.",
    pivot: "Tabs → Threads",
    icon: "heroicons:map",
  },
  {
    slug: "workspace",
    title: "Address Workspace",
    summary:
      "Address-centric hub: source, risks, storage, recent activity in one place. Sub-tabs live inside the workspace, not at the app top.",
    pivot: "Routes → Subjects",
    icon: "heroicons:identification",
  },
] as const;

function Index() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-10">
        <div
          className="text-xs uppercase tracking-widest mb-2 theme-text-muted"
        >
          Drafts
        </div>
        <h1
          className="text-3xl font-semibold mb-3 theme-text"
        >
          Layout explorations
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed theme-text-secondary"
        >
          Two concrete pivots away from the current route-per-tool shell. Each
          draft renders with mock data so we can react to the shape before
          wiring anything up. Both are now being built for real, so treat these
          as the argument that was made, not as the current UI.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DRAFTS.map((d) => (
          <Link
            key={d.slug}
            to={`/drafts/${d.slug}`}
            className="card p-5 transition-colors hover:shadow-lg block group theme-text"
            style={{ textDecoration: "none" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className="w-10 h-10 flex items-center justify-center theme-accent-bg theme-accent"
              >
                <Icon icon={d.icon} className="w-5 h-5" />
              </div>
              <span
                className="text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 theme-tertiary-bg theme-text-muted"
              >
                {d.pivot}
              </span>
            </div>
            <div
              className="text-base font-semibold mb-2 group-hover:underline theme-text"
            >
              {d.title}
            </div>
            <div
              className="text-sm leading-relaxed theme-text-secondary"
            >
              {d.summary}
            </div>
            <div
              className="mt-5 flex items-center gap-1.5 text-xs font-medium theme-accent"
            >
              Preview
              <Icon icon="heroicons:arrow-right" className="w-3.5 h-3.5" />
            </div>
          </Link>
        ))}
      </div>

      <div
        className="mt-12 p-5 card text-sm leading-relaxed theme-text-secondary"
      >
        <div
          className="font-semibold mb-2 flex items-center gap-inline theme-text"
        >
          <Icon icon="heroicons:light-bulb" className="w-4 h-4" />
          Reading these drafts
        </div>
        These are <span className="theme-text">static visual companions</span> —
        no API calls, no real data. They exist so we can argue about
        <em> shape </em>(navigation, hierarchy, what's next to what) before
        spending engineering hours wiring the real components. The existing
        app at <code className="theme-accent">/simulate</code>,
        <code className="theme-accent"> /debugger</code>, etc.
        is untouched.
      </div>
    </div>
  );
}

export default function DraftsIndex() {
  return (
    <Routes>
      <Route index element={<Index />} />
      <Route path="journey" element={<JourneyDraft />} />
      <Route path="workspace" element={<WorkspaceDraft />} />
    </Routes>
  );
}
