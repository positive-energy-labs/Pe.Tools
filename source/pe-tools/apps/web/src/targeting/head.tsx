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
import {
  freshnessWord,
  PaneStrip,
  peaNote,
  Picker,
  SeamChip,
  StageStrip,
  type Bindings,
  type Runner,
} from "#/targeting/kit";
import { terminals, type Link, type Product, type Verb } from "#/targeting/model";

const RUN_CSS =
  "@keyframes tb-run{from{transform:translateX(-100%)}to{transform:translateX(400%)}}";

function Caption({ b, link }: { b: Bindings; link: Link }) {
  const fresh = freshnessWord(b, link);
  const f = b.feeds[link.key];
  const warn = f?.stale || f?.state === "error";
  return (
    <span
      className="face-mono t-caption"
      style={{ color: warn ? "var(--r-caution)" : "var(--r-ink-mute)", lineHeight: 1 }}
    >
      {link.dir}
      {link.liveness ? ` · ${link.liveness}` : ""}
      {fresh ? ` · ${fresh}` : ""}
      {f?.basis?.length ? ` | basis ${f.basis.join(" / ")}` : ""}
    </span>
  );
}

function Demand({ product, k, b }: { product: Product; k: string; b: Bindings }) {
  const link = product.links.find((l) => l.key === k);
  if (!link) return null;
  const bound = b.isBound(link);
  const seam = b.feeds[k]?.seam;
  return (
    <span
      className="face-mono t-caption"
      title={`${k}: ${b.labelOf(link) ?? "unbound"}${seam ? ` — seam, needs ${seam.needs}` : ""}`}
      style={{
        color: bound ? "var(--r-ink)" : "var(--r-caution)",
        borderBottom: seam ? "1px dashed var(--r-caution)" : "1px solid transparent",
      }}
    >
      {k}
      {bound ? "" : " ∅"}
    </span>
  );
}

function verbButton(v: Verb, runner: Runner) {
  const can = runner.canRun(v);
  const busy = runner.busy === v.key;
  const common = {
    label: v.label,
    onClick: () => runner.run(v),
    reason: can.reason,
    disabled: !can.ok,
    busy,
  };
  return v.nav ? (
    <VerbButton key={v.key} tone="nav" direction="out" {...common} />
  ) : (
    <VerbButton key={v.key} tone={v.commit ? "commit" : "act"} {...common} />
  );
}

export function TargetingHead({
  product,
  b,
  runner,
  receipt,
  extra,
  aside,
}: {
  product: Product;
  b: Bindings;
  runner: Runner;
  /** Last receipt / busy line for the foot. */
  receipt?: React.ReactNode;
  /** Route-owned control appended inside a level's option list. */
  extra?: (link: Link) => React.ReactNode;
  /** Route-owned chips for the head's right edge (fixture lane, etc.). */
  aside?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.commit ?? false) - Number(y.commit ?? false),
  );
  const note = peaNote(product, b, runner);

  const gridRow = (v: Verb, i: number) => {
    const can = runner.canRun(v);
    const busy = runner.busy === v.key;
    return (
      <div
        key={v.key}
        className="relative grid items-center gap-x-4 px-2.5"
        style={{
          gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
          minHeight: 34,
          borderTop: i === 0 ? undefined : "1px solid var(--r-line-2)",
        }}
      >
        <span>{verbButton(v, runner)}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          {v.demands.length === 0 ? (
            <span className="face-mono t-caption" style={{ color: "var(--r-ink-mute)" }}>
              —
            </span>
          ) : (
            v.demands.map((k) => <Demand key={k} product={product} k={k} b={b} />)
          )}
        </span>
        <span
          className="face-mono t-caption text-right"
          style={{
            color: can.ok ? "var(--r-ink-mute)" : "var(--r-ink-2)",
            fontStyle: can.ok ? undefined : "italic",
          }}
        >
          {v.commit && !can.ok ? "" : can.ok ? "ready" : can.reason}
        </span>
        {busy ? (
          <span
            className="absolute overflow-hidden"
            style={{ left: 0, right: 0, bottom: -1, height: 2 }}
          >
            <span
              className="block h-full"
              style={{
                width: "25%",
                background: "var(--r-ink)",
                animation: "tb-run 1s linear infinite",
              }}
            />
          </span>
        ) : null}
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
      style={{ borderLeft: "1px solid var(--r-line-2)", color: "var(--r-ink-2)" }}
    >
      {expanded ? "▴" : "▾"}
    </button>
  );

  return (
    <ArtifactFrame
      head={
        <>
          <span className="t-label t-upper" style={{ color: "var(--r-ink)" }}>
            {product.name}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1">
            {terminals(product).map((t) => {
              const dim = !b.demanded.has(t.key);
              return (
                <span
                  key={t.key}
                  className="inline-flex flex-col items-start"
                  style={{ opacity: dim ? 0.45 : 1, whiteSpace: "nowrap" }}
                  title={dim ? `${t.key} is out of scope at ${b.stage.label}` : undefined}
                >
                  <Caption b={b} link={t} />
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
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
          <SeamChip product={product} feeds={b.feeds} />
        </>
      }
      foot={
        <>
          <PaneStrip product={product} b={b} />
          {receipt ?? <span />}
        </>
      }
    >
      <style>{RUN_CSS}</style>
      <StageStrip product={product} b={b} runner={runner} trailing={expandToggle} />
      {expanded ? (
        <>
          <div
            className="grid px-2.5 pt-1.5 pb-0.5 face-mono t-caption t-upper"
            style={{
              gridTemplateColumns: "12rem minmax(8rem, 1fr) minmax(10rem, 1.4fr)",
              columnGap: "1rem",
              color: "var(--r-ink-mute)",
            }}
          >
            <span>verb</span>
            <span>needs</span>
            <span className="text-right">state</span>
          </div>
          <div style={{ borderBottom: "1px solid var(--r-ink)" }}>{verbs.map(gridRow)}</div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          {verbs.map((v) => verbButton(v, runner))}
          {note ? (
            <span className="t-caption pl-2" style={{ color: "var(--r-pea-ink)" }}>
              pea · {note}
            </span>
          ) : null}
        </div>
      )}
    </ArtifactFrame>
  );
}
