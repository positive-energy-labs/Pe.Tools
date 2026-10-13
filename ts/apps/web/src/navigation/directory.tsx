import { useCallback, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight, Info, RefreshCw } from "lucide-react";
import { Button } from "#/components/lang/button";
import { Input } from "#/components/lang/input";
import { NavigationGroup } from "#/components/lang/navigation";
import { TASKS, matchingTools, routeKey, friendlyObservation } from "./model";
import { useDestination, useNavigation } from "./state";
import { Information } from "./popover";
import type { NavigationWork } from "./navigation-client";
import { PrimaryRouteControls } from "./route-controls";
import { RouteHelpButton } from "#/route/help";
import { usePublishRouteOptions } from "#/settings/options";
import type { PageOption } from "#/settings/option-state";
import type { DirectorySearch } from "./directory-search";

type DirectoryPage = DirectorySearch;
const directoryOptions: readonly PageOption<DirectoryPage>[] = [
  {
    id: "directory.sort",
    label: "Sort tools",
    scope: "page",
    kind: "choice",
    surfaces: ["web", "pwa"],
    projections: ["quick"],
    choices: [
      { value: "workflow", label: "Task", title: "Group tools by engineering task" },
      { value: "name", label: "A–Z", title: "Sort all tools by name in two columns" },
    ],
    read: (page) => page.sort,
    patch: (sort) => (sort === "workflow" || sort === "name" ? { sort } : {}),
  },
  {
    id: "directory.exposure",
    label: "Show tools",
    scope: "page",
    kind: "choice",
    surfaces: ["web", "pwa"],
    projections: ["quick"],
    choices: ["All", "Main", "Preview", "Archive"].map((value) => ({
      value,
      label: value,
      title: `Show ${value.toLowerCase()} tools`,
    })),
    read: (page) => page.exposure,
    patch: (exposure) =>
      exposure === "All" || exposure === "Main" || exposure === "Preview" || exposure === "Archive"
        ? { exposure }
        : {},
  },
];

export function WorkItem({
  work,
  onNavigate,
}: {
  work: NavigationWork;
  onNavigate?: (destination: string) => void;
}) {
  const go = useDestination();
  const { loading, error } = useNavigation();
  return (
    <div className="pe-navigation-row">
      <div className="min-w-0 flex-1">
        <Button
          label={`Resume ${work.label}`}
          refusal={
            loading || error
              ? "Refresh inventory before resuming Work"
              : work.url
                ? undefined
                : (work.reason ?? "This Work has no resumable destination")
          }
          onClick={() => {
            if (work.url) (onNavigate ?? go)(work.url);
          }}
        >
          {work.label}
        </Button>
        <p className="truncate text-ink-2">{work.context}</p>
      </div>
      <span className="t-small text-ink-2">{work.state}</span>
      <Information label={`Work: ${work.label}`} icon={Info}>
        <p>{work.context}</p>
        <p className="mt-2">
          {work.state} · revision {work.revision ?? "unknown"}
        </p>
        <p className="mt-2">
          {work.reason ??
            "Opens this Work's explicit destination; does not apply its staged changes."}
        </p>
        {work.url && <p className="mt-3 break-all face-mono">{work.url}</p>}
      </Information>
    </div>
  );
}
export function NavigationStatus() {
  const { snapshot, loading, error, refresh } = useNavigation();
  return (
    <div className="flex flex-wrap items-center gap-2 text-ink-2">
      <span>
        {loading
          ? "Reading saved Works and Pea threads…"
          : error
            ? `Navigation inventory unavailable: ${error}${snapshot ? `; cached observation ${snapshot.observedAt} retained, Work resume paused` : ""}`
            : `Saved inventory observed ${snapshot?.observedAt ?? "never"}`}
      </span>
      <Button
        label="Refresh navigation inventory"
        icon={RefreshCw}
        busy={loading}
        onClick={refresh}
      >
        Refresh
      </Button>
      {snapshot?.truncated && <span>Inventory is bounded; some records are not shown.</span>}
      {snapshot?.observations.map((observation) => (
        <p key={observation} className="w-full">
          {friendlyObservation(observation)}
        </p>
      ))}
    </div>
  );
}
export function Directory() {
  const page = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const { query, exposure, sort } = page;
  const setPage = useCallback(
    (patch: Partial<DirectoryPage>) => {
      void navigate({ to: ".", search: (previous) => ({ ...previous, ...patch }) });
    },
    [navigate],
  );
  usePublishRouteOptions("index", "Tools", directoryOptions, page, setPage);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const { snapshot } = useNavigation();
  const go = useDestination();
  const tools = matchingTools(query).filter(
    (tool) => exposure === "All" || tool.exposure === exposure,
  );
  if (sort === "name") tools.sort((a, b) => a.title.localeCompare(b.title));
  const reset = () => {
    setPage({ query: "", exposure: "All" });
  };
  const renderTool = (tool: ReturnType<typeof matchingTools>[number]) => {
    const works = snapshot?.works.filter((work) => work.route === routeKey(tool.to)) ?? [];
    const expanded = !collapsed.includes(tool.to);
    return (
      <div key={tool.to} className="min-w-0 py-2">
        <div className="pe-navigation-row">
          <tool.icon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <Button label={`Open ${tool.title}`} onClick={() => go(tool.to)}>
              {tool.title}
            </Button>
          </span>
          {tool.exposure !== "Main" && <span className="t-small text-ink-2">{tool.exposure}</span>}
          {works.length > 0 && (
            <Button
              label={`${expanded ? "Collapse" : "Expand"} ${tool.title} Works`}
              icon={ChevronRight}
              aria-expanded={expanded}
              onClick={() =>
                setCollapsed((prior) =>
                  expanded ? [...prior, tool.to] : prior.filter((path) => path !== tool.to),
                )
              }
            >
              {works.length} Works
            </Button>
          )}
          <Information label={`${tool.title} information`} icon={Info}>
            <p>{tool.description}</p>
            <p className="mt-3">
              {tool.to} · {tool.exposure} exposure proposal · maturity unverified.
            </p>
            <p className="mt-3">Runtime requirement (source-derived): {tool.runtimeNeed}.</p>
            <p className="mt-3">
              Runtime availability is not checked by this catalogue. The destination owns target
              selection and action readiness.
            </p>
            {tool.satellites && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tool.satellites.map((satellite) => (
                  <Button
                    key={satellite.to}
                    label={satellite.label}
                    onClick={() => go(satellite.to)}
                  >
                    {satellite.label}
                  </Button>
                ))}
              </div>
            )}
          </Information>
        </div>
        <p className="mt-1 truncate pl-6 text-ink-2">{tool.description}</p>
        {expanded && works.length > 0 && (
          <div className="hairline-l mt-2 ml-6 pl-3">
            <p className="t-small text-ink-2">Saved Works</p>
            {works.map((work) => (
              <WorkItem key={work.id} work={work} />
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <main className="mx-auto w-full max-w-6xl p-5">
      <PrimaryRouteControls route="index">
        <RouteHelpButton
          name="Tool directory"
          docs="Find a tool by task or description. Main, Preview and Archive are provisional exposure choices, not quality certification. Saved Works stay under the tool that owns them; unavailable destinations explain why they cannot resume. Ctrl Shift K searches tools, saved Works and Pea threads. Search and Home open explicit destinations; route-owned guards retain control of staged changes."
        />
      </PrimaryRouteControls>
      <h1 className="t-title">Find a tool</h1>
      <p className="mt-2 mb-5 text-ink-2">
        Find a tool for engineering design work. Saved Works sit beneath their tools.
      </p>
      <div className="mb-4 max-w-xl">
        <Input
          aria-label="Search tools and tasks"
          placeholder="Search a task, tool or description…"
          value={query}
          onChange={(event) => setPage({ query: event.target.value })}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-ink-2">Exposure proposal:</span>
        {(["All", "Main", "Preview", "Archive"] as const).map((value) => (
          <Button
            key={value}
            label={`Show ${value} exposure`}
            pressed={exposure === value}
            onClick={() => setPage({ exposure: value })}
          >
            {value}
          </Button>
        ))}
        <span className="ml-auto text-ink-2">Sort:</span>
        {(["workflow", "name"] as const).map((value) => (
          <Button
            key={value}
            label={`Sort by ${value}`}
            pressed={sort === value}
            onClick={() => setPage({ sort: value })}
          >
            {value === "workflow" ? "Workflow" : "A–Z"}
          </Button>
        ))}
      </div>
      <p className="mb-4 text-ink-2">
        Main, Preview and Archive are provisional exposure choices. No maturity or runtime
        availability is certified.
      </p>
      <NavigationStatus />
      <div className="mt-5 grid min-w-0 gap-x-8 gap-y-5 md:grid-cols-2">
        {sort === "name"
          ? tools.map(renderTool)
          : TASKS.map((task) => {
              const members = tools.filter((tool) => tool.task === task);
              if (!members.length) return null;
              return (
                <NavigationGroup
                  key={task}
                  label={task}
                  count={members.length}
                  forceOpen={query.length > 0}
                >
                  <div className="hairline-rows">{members.map(renderTool)}</div>
                </NavigationGroup>
              );
            })}
      </div>
      {tools.length === 0 && (
        <p className="mt-5">
          No tools match these filters.{" "}
          <Button label="Clear directory filters" onClick={reset}>
            Clear filters
          </Button>
        </p>
      )}
    </main>
  );
}
