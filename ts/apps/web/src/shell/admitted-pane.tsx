import { PaneSplit } from "@pe/kit/lang/pane";
import type { LayoutJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { JournalButtons } from "./situation-band";
import { useRouter } from "@tanstack/react-router";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import {
  Fragment,
  createElement,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ComponentType,
} from "react";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { type AdmittedMount, createRouteShell } from "./admitted-mount";
import type { AdmittedAddressPort } from "./admitted-address";

/** The router's existing history is the only URL owner; writes also notify Back/Forward listeners. */
export function admittedRouterAddress(history: {
  readonly location: { readonly search: string; readonly pathname: string; readonly hash: string };
  push(href: string): void;
  replace(href: string): void;
  subscribe(listener: () => void): () => void;
}): AdmittedAddressPort {
  return {
    read: () => new URLSearchParams(history.location.search),
    write(search, mode) {
      const query = search.toString();
      history[mode](
        `${history.location.pathname}${query ? `?${query}` : ""}${history.location.hash}`,
      );
    },
    subscribe: (listener) => history.subscribe(listener),
  };
}

/** Layout is a projection of the existing mount's cached predicates and panes. */
function layoutContent(mount: AdmittedMount, node: LayoutJson): ReactNode {
  if (node.kind === "pane")
    return mount.visible(node.id) ? (mount.read(node.id) as ReactNode) : null;
  if (node.kind === "gate")
    return mount.predicates()[node.when] ? layoutContent(mount, node.child) : null;
  const children = node.children
    .map((child) => layoutContent(mount, child))
    .filter((child) => child !== null);
  const split = (index: number): ReactNode =>
    index === children.length - 1
      ? children[index]
      : createElement(PaneSplit, {
          key: `${node.id}:${index}`,
          id: `${node.id}:${index}`,
          axis: node.axis === "h" ? "horizontal" : "vertical",
          resize: { target: "end", defaultSize: node.size, minSize: 1 },
          start: children[index],
          end: split(index + 1),
        });
  return children.length ? split(0) : null;
}

function Pane({ mount, layout }: { mount: AdmittedMount; layout: LayoutJson }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  return createElement(
    Fragment,
    null,
    mount.refreshable &&
      createElement(Button, { label: "refresh", onClick: () => mount.refresh() }, "refresh"),
    mount.history && createElement(JournalButtons, { owner: mount, words: true }),
    layoutContent(mount, layout),
    ...mount.commandProblems().map((problem) =>
      createElement(OutcomeLine, {
        key: problem.receiptId,
        kind: "error",
        label: "result-undecodable",
        says: `${problem.key}: ${problem.problem}`,
      }),
    ),
    ...mount.reviewIds().map((id) => {
      const review = mount.review(id)!;
      return createElement(
        "section",
        { key: id, "aria-label": `${id} review` },
        review.sentence && createElement("p", null, review.sentence),
        createElement("output", null, review.rows.join("\n")),
        createElement(
          Button,
          {
            label: `Commit ${id}`,
            kind: "commit",
            refusal: review.stale ? "Review is stale; prepare it again" : null,
            onClick: () => mount.confirm(id),
          },
          `Commit ${id}`,
        ),
        createElement(
          Button,
          { label: `Cancel ${id}`, onClick: () => mount.cancelReview(id) },
          "Cancel",
        ),
      );
    }),
  );
}

export interface AdmittedPaneProps {
  shell: ReturnType<typeof createRouteShell>;
  route: AdmittedRoute;
  address: AdmittedAddressPort;
  pane: string;
}

/** Composition runs after commit, including StrictMode cleanup/remount. No owner publishes in render. */
export function AdmittedPane({ shell, route, address }: AdmittedPaneProps) {
  const [mounted, setMounted] = useState<{
    route: AdmittedRoute;
    shell: ReturnType<typeof createRouteShell>;
    mount: AdmittedMount;
  } | null>(null);
  useEffect(() => {
    const mount = shell.mount(route, address);
    setMounted({ route, shell, mount });
    return mount.close;
  }, [shell, route, address]);
  return mounted?.route === route && mounted.shell === shell
    ? createElement(Pane, { mount: mounted.mount, layout: route.data.layout })
    : null;
}

/** Router search stays codec text; field names and types come from the admitted declaration. */
export function admittedRouteSearch<
  G extends import("../../../../packages/agent-contracts/src/route-kernel-data").RouteGraphJson,
>(_data: G) {
  return (search: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
    ) as { [K in keyof G["fields"]]?: string } & { fixture?: string };
}

/** Shared async admission/router boundary. Domain routes supply only a loader and pane id. */
export function AdmittedRouteView({
  shell,
  load,
  pane,
}: {
  shell: ReturnType<typeof createRouteShell> | ComponentType<Omit<AdmittedPaneProps, "shell">>;
  load: () => Promise<AdmittedRoute>;
  pane: string;
}) {
  const router = useRouter();
  const address = useMemo(() => admittedRouterAddress(router.history), [router]);
  const [route, setRoute] = useState<AdmittedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let retired = false;
    setRoute(null);
    setError(null);
    void load()
      .then((route) => {
        if (!retired) setRoute(route);
      })
      .catch((cause: unknown) => {
        if (!retired) setError(String(cause));
      });
    return () => {
      retired = true;
    };
  }, [load]);
  if (error)
    return createElement(OutcomeLine, { kind: "error", label: "route refused", says: error });
  return route
    ? typeof shell === "function"
      ? createElement(shell, { route, address, pane })
      : createElement(AdmittedPane, { shell, route, address, pane })
    : createElement("p", null, "Reading route...");
}
