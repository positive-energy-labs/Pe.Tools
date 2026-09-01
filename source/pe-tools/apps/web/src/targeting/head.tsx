import { useState } from "react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { Verb as VerbButton } from "#/components/lang/verb";
import { TargetCaption, TargetingFlow } from "#/targeting/flow";
import {
  PaneStrip,
  Picker,
  SeamChip,
  StageStrip,
  type Bindings,
  type Runner,
} from "#/targeting/kit";
import { InstrumentCluster } from "#/targeting/cluster";
import { targets, type Link, type Product, type Verb } from "#/targeting/model";
import { Press } from "#/components/lang/press";

function Demand<K extends string>({
  product,
  k,
  b,
}: {
  product: Product<K>;
  k: K;
  b: Bindings<K>;
}) {
  const link = product.slots[k];
  const bound = b.isBound(link);
  const seam = b.feeds[k]?.seam;
  return (
    <FactChip
      dashed={seam != null}
      tone={!bound || seam != null ? "caution" : "meta"}
      title={`${k}: ${b.labelOf(link) ?? "unbound"}${seam ? ` — seam, needs ${seam.needs}` : ""}`}
    >
      {k}
      {bound ? "" : " ∅"}
    </FactChip>
  );
}

function verbButton<K extends string>(v: Verb<K>, runner: Runner<K>) {
  const can = runner.canRun(v);
  const busy = runner.busy === v.key;
  const common = {
    label: v.label,
    onClick: () => runner.run(v),
    reason: can.reason,
    disabled: !can.ok,
    busy,
  };
  return v.kind === "nav" ? (
    <VerbButton key={v.key} tone="nav" direction="out" {...common} />
  ) : (
    <VerbButton key={v.key} tone={v.kind === "commit" ? "commit" : "act"} {...common} />
  );
}

export interface TargetingHeadProps<K extends string> {
  product: Product<K>;
  b: Bindings<K>;
  runner: Runner<K>;
  receipt?: React.ReactNode;
  extra?: (link: Link<K>) => React.ReactNode;
  /** A machine fact drawn INSIDE the sentence (the fixture chip, a schema verdict). Renamed from
   * `aside` on 2026-09-01: `RouteHead.aside` is furniture on the name line, and one word drawn at
   * two altitudes is two marks (law 1). */
  fact?: React.ReactNode;
  mode?: "sentence" | "flow" | "line";
  /** Set by `RouteHead`, which owns the route name above the sentence. Internal: no call site
   * outside this module passes it. */
  nameless?: boolean;
}

/**
 * ROUTE HEAD (S2, adopted 2026-09-01) — the route's name, and the manifest expanding BELOW it.
 *
 * The name sits on the page ground, never inside the sentence's frame: a route name carries no
 * state, and law 7 says nothing is enclosed that carries none. `manifest` is the SAME
 * `TargetingHead` every product route already renders — given a `Product` and its bindings the
 * sentence expands below the name; given none (the front door) the name stands alone below it.
 *
 * The INSTRUMENT CLUSTER rides the name line on EVERY route (ruled 2026-09-01) — host, release
 * and theme are facts about the machine the whole app runs on, not about one route. `aside` is
 * extra route chrome beside it.
 */
export function RouteHead<K extends string>({
  name,
  aside,
  manifest,
}: {
  name: string;
  /** EXTRA route chrome, beside the cluster. Not the sentence's `fact` — that one names a datum
   * inside the sentence; this one is furniture on the name's line. */
  aside?: React.ReactNode;
  manifest?: TargetingHeadProps<K>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* With a manifest the name heads an ArtifactFrame, so it takes the frame head's own inset
       * and a top gutter — the workspace rail gives its outer flow no room, and a 24px display
       * face clipped its ascenders against the viewport edge (measured on `/takeoffs`). Alone
       * (front door) it takes none and sits on the page's own frame. */}
      <div
        className={
          manifest
            ? "flex min-w-0 items-center justify-between gap-4 px-2.5 pt-2"
            : "flex min-w-0 items-center justify-between gap-4"
        }
      >
        <h1 className="t-head face-display text-ink">{name}</h1>
        <span className="flex shrink-0 items-center gap-3">
          {aside}
          <InstrumentCluster />
        </span>
      </div>
      {manifest ? <TargetingHead {...manifest} nameless /> : null}
    </div>
  );
}

/**
 * S2: every sentence/flow head IS a route head, so `TargetingHead` hands itself to `RouteHead`
 * and comes back as its manifest. `nameless` is what stops the recursion. `line` (chat's
 * embedded sentence) is NOT a route head and keeps the small inline label.
 *
 * Dispatch lives in its own component because the branch is above a hook: `TargetingSentence`
 * owns `useState`, so it may never be conditionally mounted from inside itself.
 */
export function TargetingHead<K extends string>(props: TargetingHeadProps<K>) {
  const { nameless, mode = "sentence", product } = props;
  if (nameless || mode === "line") return <TargetingSentence {...props} mode={mode} />;
  return <RouteHead name={product.name} manifest={{ ...props, mode }} />;
}

function TargetingSentence<K extends string>({
  product,
  b,
  runner,
  receipt,
  extra,
  fact,
  mode = "sentence",
  nameless,
}: TargetingHeadProps<K>) {
  const [expanded, setExpanded] = useState(false);
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.kind === "commit") - Number(y.kind === "commit"),
  );

  const gridRow = (v: Verb<K>) => {
    const can = runner.canRun(v);
    return (
      <div
        key={v.key}
        className="relative grid items-center gap-x-4 px-2.5"
        style={{
          gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
          minHeight: 34,
        }}
      >
        <span>{verbButton(v, runner)}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          {v.demands.length === 0 ? (
            <span className="face-mono t-caption text-ink-mute">—</span>
          ) : (
            v.demands.map((k) => <Demand key={k} product={product} k={k} b={b} />)
          )}
        </span>
        <span
          className={`face-mono t-caption text-right ${can.ok ? "text-ink-mute" : "text-ink-2"}`}
        >
          {v.kind === "commit" && !can.ok ? "" : can.ok ? "ready" : can.reason}
        </span>
      </div>
    );
  };

  const expandToggle = (
    <Press
      type="button"
      tone="quiet"
      size="label"
      onClick={() => setExpanded((x) => !x)}
      aria-expanded={expanded}
      title={
        expanded
          ? "Collapse the verbs back to one row"
          : "Expand the verbs: what each one needs and why it is or is not ready"
      }
    >
      <span className="face-mono">{expanded ? "▴" : "▾"}</span>
    </Press>
  );

  const line = (
    <>
      {nameless ? null : <span className="t-label">{product.name}</span>}
      <span className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1">
        {targets(product).map((t) => {
          const dim = t.dir !== null && !b.demanded.has(t.key);
          return (
            <span
              key={t.key}
              className="inline-flex flex-col items-start"
              style={{ opacity: dim ? 0.45 : 1, whiteSpace: "nowrap" }}
              title={dim ? `${t.key} is out of scope at ${b.stage.label}` : undefined}
            >
              <TargetCaption b={b} link={t} />
              <span className="inline-flex items-baseline gap-1.5">
                <span className="face-mono t-caption text-ink-2">{t.joiner}</span>
                <Picker
                  product={product}
                  link={t}
                  b={b}
                  runner={runner}
                  extra={extra}
                  inert={dim}
                />
              </span>
            </span>
          );
        })}
      </span>
      {fact}
      <SeamChip product={product} />
    </>
  );
  if (mode === "line") return <div className="flex min-w-0 flex-1 items-end gap-3">{line}</div>;

  const body = (
    <>
      <StageStrip product={product} b={b} runner={runner} trailing={expandToggle} />
      {expanded ? (
        <>
          <div
            className="t-label grid px-2.5 pt-1.5 pb-0.5"
            style={{
              gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
              columnGap: "1rem",
            }}
          >
            <span>verb</span>
            <span>needs</span>
            <span className="text-right">state</span>
          </div>
          <div>{verbs.map(gridRow)}</div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          {verbs.map((v) => verbButton(v, runner))}
        </div>
      )}
    </>
  );
  if (mode === "flow")
    return (
      <TargetingFlow
        product={product}
        b={b}
        runner={runner}
        receipt={receipt}
        extra={extra}
        fact={fact}
      >
        {body}
      </TargetingFlow>
    );

  return (
    <ArtifactFrame
      head={line}
      foot={
        <>
          <PaneStrip product={product} b={b} />
          {receipt ?? <span />}
        </>
      }
    >
      {body}
    </ArtifactFrame>
  );
}
