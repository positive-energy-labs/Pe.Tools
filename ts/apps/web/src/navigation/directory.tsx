import { Info, RefreshCw } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { useState } from "react";
import { useList, emptyListState } from "@pe/kit/lang/collection";
import { ListView, type ListRowParts } from "@pe/kit/lang/list-view";
import { TOOLS } from "./catalogue";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import type { PodRouteDescriptor } from "@pe/agent-contracts";
import { TASKS, routeKey, friendlyObservation, resumeRefusal } from "./model";
import { useDestination, useNavigation } from "./state";
import { Information } from "./popover";
import type { NavigationWork } from "./navigation-client";
import { PrimaryRouteControls } from "./route-controls";
import { RouteHelpButton } from "#/route/help";
import { useRouteLease, type AddressPage } from "#/route";
import { usePublishRouteOptions } from "#/settings/options";
import type { PageOption } from "#/settings/option-state";
import type { DirectorySearch } from "./directory-search";
import { usePodRoutes } from "#/route/pod-routes";
import { podRoutePath } from "#/route/pod-address";

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
      { value: "name", label: "A–Z", title: "Sort tools by name" },
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

type DirectoryItem =
  | { kind: "tool"; tool: (typeof TOOLS)[number]; works: DirectoryItem[] }
  | { kind: "work"; work: NavigationWork }
  | { kind: "pod"; pod: PodRouteDescriptor };
const itemKey = (item: DirectoryItem) =>
  item.kind === "tool"
    ? item.tool.to
    : item.kind === "work"
      ? `work:${item.work.id}`
      : `pod:${item.pod.key}`;
const itemTitle = (item: DirectoryItem) =>
  item.kind === "tool" ? item.tool.title : item.kind === "work" ? item.work.label : item.pod.name;

const AT = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const at = (iso: string) => AT.format(new Date(iso));

function NavigationStatus() {
  const { snapshot, loading, error, refresh } = useNavigation();
  return (
    <div className="flex flex-wrap items-center gap-2 text-ink-2">
      {/* I6: a word and its value; the reason rides the tooltip. */}
      <TooltipHint content={error ?? undefined}>
        <span>
          {loading
            ? "reading…"
            : error
              ? `unavailable${snapshot ? ` · cached ${at(snapshot.observedAt)} · resume paused` : ""}`
              : `inventory · ${snapshot ? at(snapshot.observedAt) : "never"}`}
        </span>
      </TooltipHint>
      <Button
        label="Refresh navigation inventory"
        icon={RefreshCw}
        busy={loading}
        onClick={refresh}
      >
        Refresh
      </Button>
      {snapshot?.truncated && (
        <TooltipHint content="The inventory is bounded; some records are not shown.">
          <span>bounded</span>
        </TooltipHint>
      )}
      {snapshot?.observations.map((observation) => (
        <p key={observation} className="w-full">
          {friendlyObservation(observation)}
        </p>
      ))}
    </div>
  );
}
export function Directory({ page: address }: { page: AddressPage<"home"> }) {
  const pods = usePodRoutes();
  const [page, setPage] = address;
  const { query, exposure, sort, folded } = page;
  usePublishRouteOptions("index", "Tools", directoryOptions, page, setPage);
  const { snapshot, loading, error } = useNavigation();
  const go = useDestination();
  const tools = TOOLS.filter((tool) => exposure === "All" || tool.exposure === exposure);
  const items: DirectoryItem[] = [
    ...(pods?.rows ?? []).map((pod): DirectoryItem => ({ kind: "pod", pod })),
    ...tools.map(
      (tool): DirectoryItem => ({
        kind: "tool",
        tool,
        works: (snapshot?.works ?? [])
          .filter((work) => work.route === routeKey(tool.to))
          .map((work) => ({ kind: "work", work })),
      }),
    ),
  ];
  const [local, setLocal] = useState(emptyListState<"workflow" | "name">);
  const list = useList<DirectoryItem, "workflow" | "name">({
    items,
    keyOf: itemKey,
    search: (item) => ({
      text:
        item.kind === "tool"
          ? [
              item.tool.title,
              item.tool.label,
              item.tool.description,
              item.tool.aliases,
              item.tool.task,
              item.tool.to,
            ]
          : item.kind === "work"
            ? [item.work.label, item.work.context, item.work.state]
            : [item.pod.name, item.pod.description, item.pod.packageId],
    }),
    sorts: { workflow: () => 0, name: itemTitle },
    groups: {
      of: (item) =>
        item.kind === "pod"
          ? "Pod routes"
          : item.kind === "tool"
            ? sort === "workflow"
              ? item.tool.task
              : "Tools"
            : "",
      order: ["Pod routes", ...(sort === "workflow" ? TASKS : ["Tools"])],
    },
    tree: { childrenOf: (item) => (item.kind === "tool" ? item.works : []) },
    state: {
      ...local,
      search: { v: 1, keywords: query, pills: [] },
      sort,
      open: tools.filter((tool) => !folded.includes(tool.to)).map((tool) => tool.to),
    },
    onState: (next) => {
      setLocal(next);
      setPage({
        query: next.search.keywords,
        sort: next.sort || "workflow",
        folded: [
          ...folded.filter((path) => !tools.some((tool) => tool.to === path)),
          ...tools.filter((tool) => !next.open.includes(tool.to)).map((tool) => tool.to),
        ],
      });
    },
    refusalOf: (item) =>
      item.kind === "work" ? resumeRefusal(item.work, !!(loading || error)) : undefined,
    onPick: (item) => {
      const url =
        item.kind === "tool"
          ? item.tool.to
          : item.kind === "pod"
            ? podRoutePath(item.pod.key)
            : item.work.url;
      if (url) go(url);
    },
  });
  useRouteLease("home", address, {
    facts: {
      tools: list.rows
        .filter((item) => item.item.kind === "tool")
        .slice(0, 200)
        .map(({ item }) =>
          item.kind === "tool" ? { to: item.tool.to, exposure: item.tool.exposure } : {},
        ),
    },
  });
  const row = (item: DirectoryItem): ListRowParts => {
    if (item.kind === "work")
      return {
        label: item.work.label,
        lines: 2,
        sub: item.work.context,
        meta: item.work.state,
        actions: (
          <Information label={`Work: ${item.work.label}`} icon={Info}>
            <p>{item.work.context}</p>
            <p>
              {item.work.state} revision {item.work.revision ?? "unknown"}
            </p>
            <p>
              {item.work.reason ??
                "Opens this Work's explicit destination; does not apply its staged changes."}
            </p>
          </Information>
        ),
      };
    if (item.kind === "pod")
      return {
        label: item.pod.name,
        lines: 2,
        sub: item.pod.description,
        meta: item.pod.trusted ? "Trusted" : "Trust required",
      };
    const { tool, works } = item;
    return {
      lead: <tool.icon aria-hidden />,
      label: tool.title,
      lines: 2,
      sub: tool.description,
      aside: works.length ? `${works.length} Works` : undefined,
      meta: tool.exposure === "Main" ? undefined : tool.exposure,
      actions: (
        <Information label={`${tool.title} information`} icon={Info}>
          <p>{tool.description}</p>
          <p>
            {tool.to} / {tool.exposure} exposure proposal; maturity unverified.
          </p>
          <p>Runtime requirement (source-derived): {tool.runtimeNeed}.</p>
          <p>
            Runtime availability is not checked by this catalogue. The destination owns target
            selection and action readiness.
          </p>
          {tool.satellites?.map((satellite) => (
            <Button key={satellite.to} label={satellite.label} onClick={() => go(satellite.to)}>
              {satellite.label}
            </Button>
          ))}
        </Information>
      ),
    };
  };
  return (
    <main className="mx-auto w-full max-w-6xl p-5">
      <PrimaryRouteControls route="index">
        <RouteHelpButton
          name="Tool directory"
          docs="Find a tool by task or description. Main, Preview and Archive are provisional exposure choices, not quality certification. Saved Works stay under the tool that owns them; unavailable destinations explain why they cannot resume. Ctrl Shift K searches tools, saved Works and Pea threads. Search and Home open explicit destinations; route-owned guards retain control of staged changes."
        />
      </PrimaryRouteControls>
      {/* L1/I6: the why (exposure, saved Works) is the route help above, one press away. */}
      <h1 className="t-title mb-3">Find a tool</h1>
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
      </div>
      <NavigationStatus />
      <ListView
        list={list}
        row={row}
        aria-label="tools and saved Works"
        empty={{
          message: "No tools in this exposure",
          exit: "Choose All exposure to see the catalogue",
        }}
      />
    </main>
  );
}
