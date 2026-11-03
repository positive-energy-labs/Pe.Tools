import { useContext, useRef } from "react";
import { RouteVisibility, useRouteActivity } from "../route/activity";
import { createAdmittedPlace, type AdmittedPlace } from "./admitted-place";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { z } from "zod";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment";
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

const pickerOptionsSchema = z.array(z.object({ id: z.unknown(), label: z.string() }));

function SubjectPicker({ mount, route }: { mount: AdmittedMount; route: AdmittedRoute }) {
  const field = route.data.subject.field;
  const declaration = route.data.fields[field];
  if (declaration?.role !== "subject") return null;
  const options = pickerOptionsSchema.parse(mount.picker(field) ?? []);
  const value = mount.page.read()[field];
  const many = declaration.cardinality === "many";
  const ids = many ? ((value as { kind: string; ids?: readonly unknown[] })?.ids ?? []) : [value];
  const selected = ids.map(canonicalEnvironmentInput);
  return createElement(ListPopup<(typeof options)[number]>, {
    anchor: "trigger",
    face: "control",
    triggerLabel: `Choose ${route.data.subject.noun}`,
    trigger:
      options
        .filter((option) => selected.includes(canonicalEnvironmentInput(option.id)))
        .map((option) => option.label)
        .join(", ") || `Choose ${route.data.subject.noun}`,
    "aria-label": route.data.subject.noun,
    items: options,
    keyOf: (option) => canonicalEnvironmentInput(option.id),
    labelOf: (option) => option.label,
    filter: "substring",
    select: many ? "multi" : "single",
    selected,
    empty: `No ${route.data.subject.noun} available`,
    row: (option) => ({ label: option.label }),
    onPick: (option) => {
      const key = canonicalEnvironmentInput(option.id);
      mount.controls.subject(
        many
          ? {
              kind: "ids",
              ids: selected.includes(key)
                ? ids.filter((id) => canonicalEnvironmentInput(id) !== key)
                : [...ids, option.id],
            }
          : option.id,
      );
    },
  });
}

function Pane({
  mount,
  route,
  layout,
}: {
  mount: AdmittedMount;
  route: AdmittedRoute;
  layout: LayoutJson;
}) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  const recovery = mount.recovery();
  const failure = mount.workFailure();
  const problem = mount.workProblem();
  const workMessage =
    failure?.kind === "registration-mismatch"
      ? "This tab is running an older version of this route; reload."
      : (failure?.message ?? problem);
  return createElement(
    Fragment,
    null,
    (recovery.sentence ?? workMessage) &&
      createElement(OutcomeLine, {
        kind: "error",
        label: failure?.kind ?? "Work unavailable",
        says: recovery.sentence ?? workMessage!,
      }),
    recovery.problem &&
      createElement(OutcomeLine, { kind: "error", label: "Work recovery", says: recovery.problem }),
    recovery.startFresh &&
      createElement(
        Button,
        {
          label: "Start fresh",
          refusal: recovery.busy ? "Recovery is in progress" : null,
          onClick: () => {
            void mount.startFresh().catch(() => {});
          },
        },
        "Start fresh",
      ),
    recovery.carryOver &&
      createElement(
        Button,
        {
          label: "Carry over",
          refusal: recovery.busy ? "Recovery is in progress" : null,
          onClick: () => {
            void mount.salvage().catch(() => {});
          },
        },
        "Carry over",
      ),
    createElement(SubjectPicker, { mount, route }),
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
  writable?: boolean;
}

/** Composition runs after commit, including StrictMode cleanup/remount. No owner publishes in render. */
export function AdmittedPane({ shell, route, address, writable = true }: AdmittedPaneProps) {
  const scope = useRouteActivity();
  const visible = useContext(RouteVisibility);
  const held = useRef<AdmittedPlace<AdmittedMount> | null>(null);
  const lifetime = useRef({ shell, route, address });
  const [mounted, setMounted] = useState<{
    route: AdmittedRoute;
    shell: ReturnType<typeof createRouteShell>;
    mount: AdmittedMount;
  } | null>(null);
  useEffect(() => {
    let place = held.current;
    if (
      place &&
      (lifetime.current.shell !== shell ||
        lifetime.current.route !== route ||
        lifetime.current.address !== address)
    ) {
      if (scope) scope.retire(place);
      else place.dispose();
      place = null;
      held.current = null;
    }
    if (!place) {
      lifetime.current = { shell, route, address };
      const captured = scope
        ? new URLSearchParams(
            Object.entries(scope.search).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : address.read();
      place = createAdmittedPlace<AdmittedMount>({
        scope: scope ?? {
          pathname: route.data.address,
          search: Object.fromEntries(captured),
          current: () => true,
          retain() {},
          retire() {},
        },
        address,
        search: captured,
        visible,
      });
      held.current = place;
    }
    place.setVisible(visible);
    const mount = place.state(() => shell.mount(route, place.address, () => place.memory()));
    mount.setVisible(visible);
    mount.setWritable(writable);
    const publish = () => {
      place.remember(mount.page.read());
      const roster = pickerOptionsSchema.safeParse(mount.picker(route.data.subject.field) ?? []);
      place.publishSubject({
        label: mount.subjectDisplay(),
        roster: roster.success
          ? roster.data.map((row) => ({ id: canonicalEnvironmentInput(row.id), label: row.label }))
          : [],
      });
    };
    publish();
    const unsubscribe = mount.subscribe(publish);
    setMounted({ route, shell, mount });
    return () => {
      unsubscribe();
      place.setVisible(false);
      mount.setVisible(false);
      if (!scope) {
        place.dispose();
        held.current = null;
      }
    };
  }, [shell, route, address, scope, visible, writable]);
  return mounted?.route === route && mounted.shell === shell
    ? createElement(Pane, { mount: mounted.mount, route, layout: route.data.layout })
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
