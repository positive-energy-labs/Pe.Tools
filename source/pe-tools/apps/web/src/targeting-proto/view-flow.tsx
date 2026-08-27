/**
 * PROTOTYPE — round-5 view "flow": the sentence's grammar in geometry.
 *
 * SIDE RULE (Q12 ruled): sides are the grammar's CLAUSES, not the data direction —
 *   context  (no dir)       → hoisted identity line at the top of the page block
 *   subject  (read+write)   → INSIDE the page block: it is the substrate the page operates on
 *   reads    (read)         → LEFT, arrow into the page
 *   writes · syncs          → RIGHT, arrow out of the page (sync: both heads)
 * Takeoffs: view → [ page · editing ProjectA_Cloud.rvt ] → zones, .r10. No picker shares a
 * side with the rvt any more.
 *
 * Arrows carry PROGRESS: a quiet shaft at rest; in flight the shaft goes ink and a dot
 * travels along it in the data direction (opacity/motion only — dashed stays the seam slot);
 * `--pe-done` for 800ms after landing. Detached = gap + hollow connectors.
 * Throwaway with the round.
 */
import { useEffect, useState } from "react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Verb } from "#/components/lang/verb";
import {
  PaneStrip,
  PathInput,
  peaNote,
  SeamChip,
  StageStrip,
  useBindings,
  useRunner,
  type Bindings,
  type Runner,
} from "#/targeting-proto/kit";
import { endpoints, pathOf, sharedPrefix, type Link, type Product } from "#/targeting-proto/model";

type Side = "subject" | "left" | "right";
const sideOf = (l: Link): Side =>
  l.dir === "read+write" ? "subject" : l.dir === "read" ? "left" : "right";

type Flight = "rest" | "live" | "done";

const GUTTER = 64;
const MID = 8;

function Arrow({
  dir,
  flight,
  detached,
}: {
  dir: "in" | "out" | "both";
  flight: Flight;
  detached: boolean;
}) {
  const color =
    flight === "live" ? "var(--pe-ink)" : flight === "done" ? "var(--pe-done)" : "var(--pe-line-2)";
  const w = flight === "rest" ? 1 : 1.5;
  const x1 = 4;
  const x2 = GUTTER - 4;
  const gap = (x1 + x2) / 2;
  const head = (x: number, d: 1 | -1) => (
    <path
      d={`M ${x - 5 * d} ${MID - 3.5} L ${x} ${MID} L ${x - 5 * d} ${MID + 3.5}`}
      fill="none"
      stroke={color}
      strokeWidth={w}
      strokeLinejoin="round"
    />
  );
  const shaft = detached ? (
    <>
      <line x1={x1} y1={MID} x2={gap - 6} y2={MID} stroke={color} strokeWidth={w} />
      <line x1={gap + 6} y1={MID} x2={x2} y2={MID} stroke={color} strokeWidth={w} />
      <circle
        cx={gap - 6}
        cy={MID}
        r={2.5}
        fill="var(--pe-artifact)"
        stroke={color}
        strokeWidth={w}
      />
      <circle
        cx={gap + 6}
        cy={MID}
        r={2.5}
        fill="var(--pe-artifact)"
        stroke={color}
        strokeWidth={w}
      />
    </>
  ) : (
    <line x1={x1} y1={MID} x2={x2} y2={MID} stroke={color} strokeWidth={w} />
  );
  // the traveling dot: motion is the mark, no dash spent
  const from = dir === "out" ? x1 : x2;
  const to = dir === "out" ? x2 : x1;
  return (
    <svg width={GUTTER} height={16} aria-hidden style={{ flex: "none", overflow: "visible" }}>
      {shaft}
      {dir !== "in" ? head(x2, 1) : null}
      {dir !== "out" ? head(x1, -1) : null}
      {flight === "live" ? (
        <circle r={2.5} cy={MID} fill="var(--pe-ink)">
          <animate
            attributeName="cx"
            values={`${from};${to}`}
            dur="0.7s"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
    </svg>
  );
}

function Node({
  product,
  link,
  b,
  runner,
  flash,
  prefix,
}: {
  product: Product;
  link: Link;
  b: Bindings;
  runner: Runner;
  flash: Set<string>;
  prefix: Link[];
}) {
  const side = sideOf(link);
  const chain = pathOf(product, link.key).filter((l) => !prefix.some((p) => p.key === l.key));
  const dim = !b.demanded.has(link.key);
  const flight: Flight = runner.active.has(link.key)
    ? "live"
    : flash.has(link.key)
      ? "done"
      : "rest";
  const seam = link.options === null;
  const node = (
    <div
      className="flex min-w-0 flex-col px-2 py-1"
      style={{
        background: "var(--pe-artifact)",
        boxShadow: `inset 0 0 0 1px ${seam ? "var(--pe-caution)" : "var(--pe-line)"}`,
        borderStyle: seam ? "dashed" : undefined,
        border: seam ? "1px dashed var(--pe-caution)" : undefined,
        alignItems: side === "left" ? "flex-end" : "flex-start",
        minWidth: 140,
      }}
    >
      <span className="face-mono t-caption" style={{ color: "var(--pe-ink-mute)", lineHeight: 1.2 }}>
        {link.dir}
        {link.liveness ? ` · ${link.liveness}` : ""}
      </span>
      <PathInput product={product} chain={chain} b={b} runner={runner} mode="segmented" />
    </div>
  );
  return (
    <div
      className="flex items-center"
      style={{
        opacity: dim ? 0.45 : 1,
        flexDirection: side === "left" ? "row" : "row-reverse",
        justifyContent: "flex-start",
      }}
      title={dim ? `${link.key} is out of scope at ${b.stage.label}` : undefined}
    >
      {node}
      <Arrow
        dir={side === "left" ? "in" : link.dir === "sync" ? "both" : "out"}
        flight={flight}
        detached={link.liveness === "detached"}
      />
    </div>
  );
}

export function FlowView({ product }: { product: Product }) {
  const b = useBindings(product);
  const runner = useRunner(product, b);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  useEffect(() => {
    const last = runner.last;
    if (!last) return;
    const verb = product.stages.flatMap((s) => s.verbs).find((v) => v.key === last.verb);
    if (!verb) return;
    setFlash(new Set(verb.demands));
    const t = setTimeout(() => setFlash(new Set()), 800);
    return () => clearTimeout(t);
  }, [runner.last, product]);

  const prefix = sharedPrefix(product);
  const inPrefix = (l: Link) => prefix.some((p) => p.key === l.key);
  const eps = endpoints(product);
  const subjects = eps.filter((l) => sideOf(l) === "subject");
  const left = eps.filter((l) => sideOf(l) === "left");
  const right = eps.filter((l) => sideOf(l) === "right");
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.commit ?? false) - Number(y.commit ?? false),
  );
  const note = peaNote(product, b, runner);

  const rail = (links: Link[], side: "left" | "right") => (
    <div
      className={`flex min-w-0 flex-col justify-center gap-1.5 ${side === "left" ? "items-end" : "items-start"}`}
    >
      <span className="face-mono t-caption t-upper px-1" style={{ color: "var(--pe-ink-mute)" }}>
        {side === "left" ? "reads" : "writes · syncs"}
      </span>
      {links.length > 0 ? (
        links.map((l) => (
          <Node
            key={l.key}
            product={product}
            link={l}
            b={b}
            runner={runner}
            flash={flash}
            prefix={prefix}
          />
        ))
      ) : (
        <span className="face-mono t-caption px-1" style={{ color: "var(--pe-ink-mute)" }}>
          {side === "left" ? "no read-only source" : "nothing leaves the subject"}
        </span>
      )}
    </div>
  );

  return (
    <div className="px-2">
      <div
        className="grid items-center gap-0"
        style={{ gridTemplateColumns: "minmax(0,1fr) minmax(300px,1.3fr) minmax(0,1fr)" }}
      >
        {rail(left, "left")}
        <ArtifactFrame
          head={
            <>
              <span className="t-label t-upper" style={{ color: "var(--pe-ink)" }}>
                {product.name}
              </span>
              {prefix.length > 0 ? (
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="face-mono t-caption" style={{ color: "var(--pe-ink-2)" }}>
                    {prefix[0]!.joiner}
                  </span>
                  <PathInput
                    product={product}
                    chain={prefix}
                    b={b}
                    mode="segmented"
                    showAll
                    tone="mute"
                  />
                </span>
              ) : null}
              <span className="ml-auto">
                <SeamChip product={product} />
              </span>
            </>
          }
          foot={
            <>
              <PaneStrip product={product} b={b} />
              <span
                className="face-mono t-caption"
                style={{ color: runner.last ? "var(--pe-done)" : "var(--pe-ink-mute)" }}
              >
                {runner.last ? `ran ${runner.last.verb}` : "idle"}
              </span>
            </>
          }
        >
          {/* THE SUBJECT — inside the page: what this page operates on */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1 px-2.5 py-1.5">
            {subjects.length === 0 ? (
              <span className="face-mono t-caption" style={{ color: "var(--pe-ink-mute)" }}>
                no subject — this page operates on nothing it can write back to
              </span>
            ) : (
              subjects.map((s) => {
                const chain = pathOf(product, s.key).filter((l) => !inPrefix(l));
                const dim = !b.demanded.has(s.key);
                return (
                  <span
                    key={s.key}
                    className="inline-flex flex-col"
                    style={{ opacity: dim ? 0.45 : 1 }}
                  >
                    <span
                      className="face-mono t-caption"
                      style={{ color: "var(--pe-ink-mute)", lineHeight: 1.2 }}
                    >
                      subject · {s.dir}
                      {s.liveness ? ` · ${s.liveness}` : ""}
                    </span>
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="face-mono t-caption" style={{ color: "var(--pe-ink-2)" }}>
                        {s.joiner}
                      </span>
                      {chain.length === 0 ? (
                        <span className="face-mono t-label" style={{ color: "var(--pe-ink-2)" }}>
                          {s.key}
                        </span>
                      ) : (
                        <PathInput
                          product={product}
                          chain={chain}
                          b={b}
                          runner={runner}
                          mode="segmented"
                        />
                      )}
                    </span>
                  </span>
                );
              })
            )}
          </div>
          <StageStrip product={product} b={b} runner={runner} />
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
            {verbs.map((v) => {
              const can = runner.canRun(v);
              return (
                <Verb
                  key={v.key}
                  label={v.label}
                  tone={v.commit === true ? "commit" : "act"}
                  reason={can.reason}
                  disabled={!can.ok}
                  busy={runner.busy.has(v.key)}
                  onClick={() => runner.run(v)}
                />
              );
            })}
            {note ? (
              <span className="t-caption pl-2" style={{ color: "var(--pe-pea-ink)" }}>
                pea · {note}
              </span>
            ) : null}
          </div>
        </ArtifactFrame>
        {rail(right, "right")}
      </div>
    </div>
  );
}
