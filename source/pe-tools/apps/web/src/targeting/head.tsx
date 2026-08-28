import { token } from "#/lib/token";
/**
 * TARGETING HEAD — the one artifact a route mounts to say what it reaches and what it can do.
 *
 * Head: the sentence — one clause `joiner <Picker>` per TERMINAL, nothing else (trunks live
 * inside the pickers). Body: the stage strip with its readiness meter, then the current
 * stage's verbs as a compact rail; the rail's trailing `▾` expands it in place into the
 * vertical grid (verb · needs · state) when the user wants context. Foot: panes
 * (demand-gated) + the last receipt.
 */
import { useState } from "react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
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
import { targets, type Link, type Product, type Verb } from "#/targeting/model";

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
    <span
      className="face-mono t-caption"
      title={`${k}: ${b.labelOf(link) ?? "unbound"}${seam ? ` — seam, needs ${seam.needs}` : ""}`}
      style={{
        color: bound ? token("ink") : token("caution"),
        borderBottom: seam ? `1px dashed ${token("caution")}` : "1px solid transparent",
      }}
    >
      {k}
      {bound ? "" : " ∅"}
    </span>
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

export function TargetingHead<K extends string>({
  product,
  b,
  runner,
  receipt,
  extra,
  aside,
  mode = "sentence",
}: {
  product: Product<K>;
  b: Bindings<K>;
  runner: Runner<K>;
  /** Last receipt / busy line for the foot. */
  receipt?: React.ReactNode;
  /** Route-owned control appended inside a level's option list. */
  extra?: (link: Link<K>) => React.ReactNode;
  /** Route-owned chips for the head's right edge (fixture lane, etc.). */
  aside?: React.ReactNode;
  mode?: "sentence" | "flow" | "line";
}) {
  const [expanded, setExpanded] = useState(false);
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.kind === "commit") - Number(y.kind === "commit"),
  );

  const gridRow = (v: Verb<K>, i: number) => {
    const can = runner.canRun(v);
    return (
      <div
        key={v.key}
        className="relative grid items-center gap-x-4 px-2.5"
        style={{
          gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
          minHeight: 34,
          borderTop: i === 0 ? undefined : `1px solid ${token("line-2")}`,
        }}
      >
        <span>{verbButton(v, runner)}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          {v.demands.length === 0 ? (
            <span className="face-mono t-caption" style={{ color: token("ink-mute") }}>
              —
            </span>
          ) : (
            v.demands.map((k) => <Demand key={k} product={product} k={k} b={b} />)
          )}
        </span>
        <span
          className="face-mono t-caption text-right"
          style={{
            color: can.ok ? token("ink-mute") : token("ink-2"),
            fontStyle: can.ok ? undefined : "italic",
          }}
        >
          {v.kind === "commit" && !can.ok ? "" : can.ok ? "ready" : can.reason}
        </span>
      </div>
    );
  };

  const expandToggle = (
    <button
      type="button"
      onClick={() => setExpanded((x) => !x)}
      aria-expanded={expanded}
      title={
        expanded
          ? "Collapse the verbs back to one row"
          : "Expand the verbs: what each one needs and why it is or is not ready"
      }
      className="face-mono t-caption px-2.5"
      style={{ borderLeft: `1px solid ${token("line-2")}`, color: token("ink-2") }}
    >
      {expanded ? "▴" : "▾"}
    </button>
  );

  const line = (
    <>
      <span className="t-label t-upper" style={{ color: token("ink") }}>
        {product.name}
      </span>
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
                <span className="face-mono t-caption" style={{ color: token("ink-2") }}>
                  {t.joiner}
                </span>
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
      {aside}
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
            className="grid px-2.5 pt-1.5 pb-0.5 face-mono t-caption t-upper"
            style={{
              gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
              columnGap: "1rem",
              color: token("ink-mute"),
            }}
          >
            <span>verb</span>
            <span>needs</span>
            <span className="text-right">state</span>
          </div>
          <div style={{ borderBottom: `1px solid ${token("ink")}` }}>{verbs.map(gridRow)}</div>
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
        aside={aside}
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
