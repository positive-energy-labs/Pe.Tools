import { useContext, useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { Pane } from "./pane";
import { PaneSplit, type PaneSide } from "./pane-resize";
import { declaredTeaching, registerTeaching, type Teaching, type TeachingLayout } from "./teach";
import { registerTeachingMeasure, teachingBox, teachingTitle } from "./teach-measure";
import { TeachInstance, TeachLive, TeachPage, TeachPane } from "./use-teach";

type LeafIds<L> = L extends { id: infer I extends string }
  ? string extends I
    ? never
    : L extends { start: infer S; end: infer E }
      ? LeafIds<S> | LeafIds<E>
      : I
  : never;
type Furniture = Pick<
  ComponentProps<typeof Pane>,
  | "title"
  | "meta"
  | "actions"
  | "leadingActions"
  | "tabs"
  | "modes"
  | "layers"
  | "floaters"
  | "legend"
  | "overlay"
>;
/** The leaf supplies body and furniture; identity, Pane creation and topology stay with composition. */
export type TeachingPaneRender = (body: ReactNode, furniture?: Furniture) => ReactNode;
type TeachingContent = (pane: TeachingPaneRender) => ReactNode;
type TeachingLayoutState = {
  sizes?: Readonly<Record<string, { size?: number; onChange: (size: number) => void }>>;
  conditions?: Readonly<Record<string, { available: boolean; reason?: string }>>;
  choices?: Readonly<Record<string, { value: PaneSide; onChange: (side: PaneSide) => void }>>;
  folds?: Readonly<
    Record<
      string,
      {
        collapsed?: PaneSide | null;
        onChange?: (side: PaneSide | null) => void;
        startTitle?: string;
        endTitle?: string;
      }
    >
  >;
};

/** One complete tree renders every structural Pane/Split. Only content leaf ids are replaceable. */
export function TeachingLayoutView<const L extends TeachingLayout>({
  layout,
  content,
  state = {},
}: {
  layout: L;
  content: { readonly [K in LeafIds<NoInfer<L>>]: TeachingContent };
  state?: TeachingLayoutState;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useId();
  const page = useContext(TeachPage);
  const live = useContext(TeachLive);
  const conditions = JSON.stringify(state.conditions ?? {});
  useEffect(() => {
    const host = root.current;
    if (!host || !live) return;
    const availability = JSON.parse(conditions) as NonNullable<TeachingLayoutState["conditions"]>;
    const reference = declaredTeaching(layout);
    let previous = "";
    let withdraw: (() => void) | undefined;
    const measure = () => {
      const box = teachingBox(host);
      const instanceVisible = host.isConnected && box.width > 0 && box.height > 0;
      const panes = new Map(
        [...host.querySelectorAll<HTMLElement>("[data-pane-id]")].map((node) => [
          node.dataset.paneId,
          node,
        ]),
      );
      const splits = new Map(
        [...host.querySelectorAll<HTMLElement>("[data-layout-split]")].map((node) => [
          node.dataset.layoutSplit,
          node,
        ]),
      );
      const nodes = new Map<string, TeachingLayout>();
      const collect = (node: TeachingLayout) => {
        nodes.set(node.id, node);
        if ("axis" in node) {
          collect(node.start);
          collect(node.end);
        }
      };
      collect(layout);
      const facts: Teaching[] = reference.map((fact): Teaching => {
        const node = nodes.get(fact.kind === "region" ? fact.id : fact.region!)!;
        const id = `${instance}:${fact.id}`;
        const region = `${instance}:${fact.region ?? fact.id}`;
        if (fact.kind !== "region") return { ...fact, id, region, page, instance };
        const folded = (fact.path ?? []).filter(
          (step) => splits.get(step.split)?.dataset.paneFolded === step.side,
        );
        const unavailable = [node, ...(fact.path ?? []).map((step) => nodes.get(step.split)!)].find(
          (node) => node.available && availability[node.available]?.available === false,
        );
        const pane = panes.get(node.id);
        const rect = pane && teachingBox(pane);
        const visible =
          instanceVisible && !folded.length && rect && rect.width > 0 && rect.height > 0;
        const first = folded[0];
        const rail =
          first &&
          [
            ...(splits.get(first.split)?.querySelectorAll<HTMLElement>("[data-pane-rail-side]") ??
              []),
          ].find(
            (node) =>
              node.dataset.paneRailSide === first.side &&
              node.closest("[data-layout-split]") === splits.get(first.split),
          );
        const railBox = rail && teachingBox(rail);
        return {
          ...fact,
          id,
          region,
          node: node.id,
          label: (pane && teachingTitle(pane)) || fact.label,
          instance,
          instanceVisible,
          page,
          source: undefined,
          rect: visible
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : undefined,
          visibility: visible ? "visible" : folded.length ? "folded" : "unmounted",
          foldedBy: folded.map((step) => step.split),
          available: !unavailable,
          refusal: unavailable?.available ? availability[unavailable.available]?.reason : undefined,
          rail:
            instanceVisible && rail && railBox && railBox.width > 0 && railBox.height > 0 && first
              ? {
                  id: `${first.split}:${first.side}`,
                  orientation:
                    splits.get(first.split)?.dataset.axis === "horizontal"
                      ? "vertical"
                      : "horizontal",
                  label: rail.textContent?.trim() ?? "Folded pane",
                  rect: {
                    left: railBox.left,
                    top: railBox.top,
                    width: railBox.width,
                    height: railBox.height,
                  },
                }
              : undefined,
        };
      });
      const stamp = JSON.stringify(facts);
      if (stamp === previous) return;
      previous = stamp;
      withdraw?.();
      withdraw = registerTeaching(facts);
    };
    measure();
    const unmeasure = registerTeachingMeasure({ nodes: [host], measure });
    return () => {
      unmeasure();
      withdraw?.();
    };
  }, [layout, instance, page, live, conditions]);

  const render = (node: TeachingLayout): ReactNode => {
    const condition = (key: string) => {
      const value = state.conditions?.[key];
      if (!value) throw new Error(`Missing composition condition ${key}`);
      return value;
    };
    if (node.available) condition(node.available);
    if (!("axis" in node)) {
      if (node.mount && condition(node.mount).available === false) return null;
      const pane: TeachingPaneRender = (body, furniture = {}) => {
        const { legend, ...chrome } = furniture;
        const common = {
          ...chrome,
          id: node.id,
          title: node.pane?.header === false ? undefined : (furniture.title ?? node.label),
          help: node.pane?.header === false ? undefined : node.purpose,
          scroll: node.pane?.scroll,
          flush: node.pane?.flush,
        };
        return (
          <TeachPane value={`${instance}:${node.id}`}>
            {node.pane?.picture ? (
              <Pane {...common} picture legend={legend}>
                {body}
              </Pane>
            ) : (
              <Pane {...common}>{body}</Pane>
            )}
          </TeachPane>
        );
      };
      return (content as Readonly<Record<string, TeachingContent>>)[node.id](pane);
    }
    const choice = node.choice && state.choices?.[node.choice];
    const fold = state.folds?.[node.id];
    if (node.choice && !choice) throw new Error(`Missing composition choice ${node.choice}`);
    if (node.rails && !choice && !fold?.onChange)
      throw new Error(`Missing composition fold ${node.id}`);
    const closed: PaneSide = choice && choice.value === "start" ? "end" : "start";
    const child = closed === "start" ? node.start : node.end;
    const refusal =
      child.available && state.conditions?.[child.available]?.available === false
        ? state.conditions[child.available]?.reason
        : undefined;
    const rails = Object.fromEntries(
      Object.entries(node.rails ?? {}).map(([side, rail]) => [
        side,
        {
          ...rail,
          title: (side === "start" ? fold?.startTitle : fold?.endTitle) ?? rail.title,
          refusal: choice && side === closed ? refusal : undefined,
        },
      ]),
    );
    const minimumOther =
      typeof node.minOtherSize === "object"
        ? state.conditions?.[node.minOtherSize.when]?.available
          ? node.minOtherSize.yes
          : node.minOtherSize.no
        : node.minOtherSize;
    return (
      <PaneSplit
        key={node.id}
        id={node.id}
        axis={node.axis}
        resize={{
          target: node.target,
          defaultSize: node.size,
          size: state.sizes?.[node.id]?.size,
          onSizeChange: state.sizes?.[node.id]?.onChange,
          minSize: node.minSize ?? 0,
          minOtherSize: minimumOther,
          maxSize: node.maxSize,
          persist: node.persist,
          collapse: node.rails
            ? {
                ...rails,
                collapsed: choice ? closed : (fold?.collapsed ?? null),
                onCollapsedChange: (side) => {
                  if (choice) {
                    if (side == null && !refusal) choice.onChange(closed);
                  } else fold?.onChange?.(side);
                },
              }
            : undefined,
        }}
        start={render(node.start)}
        end={render(node.end)}
      />
    );
  };
  return (
    <TeachInstance value={instance}>
      <div
        ref={root}
        data-teaching-layout={layout.id}
        className="flex size-full min-h-0 min-w-0 flex-1 flex-col"
      >
        {render(layout)}
      </div>
    </TeachInstance>
  );
}
