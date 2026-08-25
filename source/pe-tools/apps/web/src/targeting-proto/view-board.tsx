/**
 * PROTOTYPE — round-5 view "board": CAPABILITY NOW, refined and brutalist.
 *
 * Round-4 verdict: the horizontal stage strip with readiness meter + a vertical verb list
 * with notes to the right is the shape. Round 5 hardens it: one artifact, hard 1px rules,
 * mono uppercase labels, a fixed three-column grid (verb · demands · note) so the notes
 * align, no radius, no chips — demands are plain mono words (ink bound · caution unbound ·
 * dashed underline only for a seam). Head hoists the prefix once (the 3× repeat is gone).
 * Throwaway with the round.
 */
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Verb } from "#/components/lang/verb";
import {
  PaneStrip,
  PathInput,
  SeamChip,
  StageStrip,
  useBindings,
  useRunner,
  type Bindings,
} from "#/targeting-proto/kit";
import {
  endpoints,
  pathOf,
  sharedPrefix,
  type Link,
  type Product,
  type Verb as V,
} from "#/targeting-proto/model";

const RUN_CSS =
  "@keyframes tb-run{from{transform:translateX(-100%)}to{transform:translateX(400%)}}";

const isSeam = (l: Link) => l.options === null || l.source === "fixture";

/** A demanded endpoint as a WORD: ink bound, caution unbound, seam = dashed underline. */
function Demand({ product, k, b }: { product: Product; k: string; b: Bindings }) {
  const link = product.links.find((l) => l.key === k);
  if (!link) return null;
  const bound = b.isBound(link);
  return (
    <span
      className="face-mono t-caption"
      title={`${k}: ${b.labelOf(link) ?? "unbound"}${isSeam(link) ? ` — seam, needs ${link.needs}` : ""}`}
      style={{
        color: bound ? "var(--r-ink)" : "var(--r-caution)",
        borderBottom: isSeam(link) ? "1px dashed var(--r-caution)" : "1px solid transparent",
      }}
    >
      {k}
      {bound ? "" : " ∅"}
    </span>
  );
}

export function BoardView({ product }: { product: Product }) {
  const b = useBindings(product);
  const runner = useRunner(product, b);
  const prefix = sharedPrefix(product);
  const inPrefix = (l: Link) => prefix.some((p) => p.key === l.key);
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.commit ?? false) - Number(y.commit ?? false),
  );

  const row = (v: V, i: number) => {
    const can = runner.canRun(v);
    const busy = runner.busy.has(v.key);
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
        <span>
          <Verb
            label={v.label}
            tone={v.commit === true ? "commit" : "act"}
            onClick={() => runner.run(v)}
            reason={can.reason}
            disabled={!can.ok}
            busy={busy}
          />
        </span>
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
          {/* a disabled COMMIT already prints its reason (verb.tsx exception) — never twice */}
          {v.commit === true && !can.ok ? "" : can.ok ? "ready" : can.reason}
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

  return (
    <div className="px-2">
      <style>{RUN_CSS}</style>
      <ArtifactFrame
        head={
          <>
            <span className="t-label t-upper" style={{ color: "var(--r-ink)" }}>
              {product.name}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
              {prefix.length > 0 ? (
                <PathInput
                  product={product}
                  chain={prefix}
                  b={b}
                  mode="segmented"
                  showAll
                  tone="mute"
                />
              ) : null}
              {endpoints(product).map((e) => {
                const chain = pathOf(product, e.key).filter((l) => !inPrefix(l));
                if (chain.length === 0) return null;
                const dim = !b.demanded.has(e.key);
                return (
                  <span
                    key={e.key}
                    className="inline-flex items-baseline gap-1.5"
                    style={{ opacity: dim ? 0.45 : 1 }}
                    title={dim ? `${e.key} is out of scope at ${b.stage.label}` : undefined}
                  >
                    <span
                      className="face-mono t-caption t-upper"
                      style={{ color: "var(--r-ink-mute)" }}
                    >
                      {e.dir}
                    </span>
                    <PathInput
                      product={product}
                      chain={chain}
                      b={b}
                      runner={runner}
                      mode="segmented"
                    />
                  </span>
                );
              })}
            </span>
            <SeamChip product={product} />
          </>
        }
        foot={
          <>
            <PaneStrip product={product} b={b} />
            <span
              className="face-mono t-caption"
              style={{ color: runner.last ? "var(--r-done)" : "var(--r-ink-mute)" }}
            >
              {runner.last ? `ran ${runner.last.verb}` : "idle"}
            </span>
          </>
        }
      >
        <StageStrip product={product} b={b} runner={runner} />
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
        <div
          style={{ borderTop: "1px solid var(--r-ink)", borderBottom: "1px solid var(--r-ink)" }}
        >
          {verbs.map(row)}
        </div>
      </ArtifactFrame>
    </div>
  );
}
