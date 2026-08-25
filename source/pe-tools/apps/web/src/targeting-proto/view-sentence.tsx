/**
 * PROTOTYPE — round-5 view "sentence": the primary presentation (ruled round 4).
 *
 * HOISTED (Q1 ruled): the dominant chain renders once as the identity clause; each endpoint
 * is one clause `joiner  <PathInput>` whose closed state is the LEAF only. Ancestors outside
 * the prefix live INSIDE the endpoint's input (open it to see / re-pick them).
 *
 * THE ROUND-5 QUESTION: which single-input shape collapses a waterfall best —
 *   segmented (VS Code breadcrumb) · columns (Finder) · search (palette). In-place switch.
 * Artifact posture (ruled round 4): head = identity + sentence, body = stage strip + verbs,
 * foot = panes + receipt. Pea's line appears only when a demand is missing.
 * Throwaway with the round.
 */
import { useState } from "react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Switcher } from "#/components/lang/switcher";
import { Verb } from "#/components/lang/verb";
import {
  PaneStrip,
  PathInput,
  peaNote,
  SeamChip,
  StageStrip,
  useBindings,
  useRunner,
  type InputMode,
} from "#/targeting-proto/kit";
import { endpoints, pathOf, sharedPrefix, type Link, type Product } from "#/targeting-proto/model";

/** Second-look caption: direction · liveness, small and mute. Hover on the noun says more. */
function Caption({ link }: { link: Link }) {
  return (
    <span className="face-mono t-caption" style={{ color: "var(--r-ink-mute)", lineHeight: 1 }}>
      {link.dir}
      {link.liveness ? ` · ${link.liveness}` : ""}
    </span>
  );
}

export function SentenceView({ product }: { product: Product }) {
  const b = useBindings(product);
  const runner = useRunner(product, b);
  const [mode, setMode] = useState<InputMode>("segmented");

  const prefix = sharedPrefix(product);
  const inPrefix = (l: Link) => prefix.some((p) => p.key === l.key);
  const eps = endpoints(product);
  const verbs = [...b.stage.verbs].sort(
    (x, y) => Number(x.commit ?? false) - Number(y.commit ?? false),
  );
  const note = peaNote(product, b, runner);

  return (
    <div className="px-2">
      <div className="flex items-center gap-2 pb-1">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          proto · input
        </span>
        <Switcher
          ariaLabel={`${product.name} input shape`}
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "segmented",
              label: "segmented",
              title: "Open: the chain as segments; pick one level at a time, auto-advance.",
            },
            {
              value: "columns",
              label: "columns",
              title: "Open: one column per level, Finder-style; every level visible at once.",
            },
            {
              value: "search",
              label: "search",
              title: "Open: one text field; results are whole paths; picking binds every level.",
            },
          ]}
        />
      </div>

      <ArtifactFrame
        head={
          <>
            <span className="t-label t-upper" style={{ color: "var(--r-ink)" }}>
              {product.name}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1">
              {prefix.length > 0 ? (
                <span
                  className="inline-flex items-baseline gap-1.5"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {prefix[0]!.joiner}
                  </span>
                  <PathInput
                    product={product}
                    chain={prefix}
                    b={b}
                    mode={mode}
                    showAll
                    tone="mute"
                  />
                </span>
              ) : null}
              {eps.map((e) => {
                const chain = pathOf(product, e.key).filter((l) => !inPrefix(l));
                const dim = !b.demanded.has(e.key);
                return (
                  <span
                    key={e.key}
                    className="inline-flex flex-col items-start"
                    style={{ opacity: dim ? 0.45 : 1, whiteSpace: "nowrap" }}
                    title={dim ? `${e.key} is out of scope at ${b.stage.label}` : undefined}
                  >
                    <Caption link={e} />
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                        {e.joiner}
                      </span>
                      {chain.length === 0 ? (
                        // the endpoint IS in the prefix (takeoffs' rvt): a back-reference
                        <span className="face-mono t-label" style={{ color: "var(--r-ink-2)" }}>
                          {e.key}
                        </span>
                      ) : (
                        <PathInput
                          product={product}
                          chain={chain}
                          b={b}
                          runner={runner}
                          mode={mode}
                        />
                      )}
                    </span>
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
            {runner.last ? (
              <span className="face-mono t-caption" style={{ color: "var(--r-done)" }}>
                ran {runner.last.verb}
              </span>
            ) : (
              <span />
            )}
          </>
        }
      >
        <StageStrip product={product} b={b} runner={runner} />
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
          {verbs.map((v) => {
            const can = runner.canRun(v);
            return (
              <Verb
                key={v.key}
                label={v.label}
                tone={v.commit === true ? "commit" : "act"}
                onClick={() => runner.run(v)}
                reason={can.reason}
                disabled={!can.ok}
                busy={runner.busy.has(v.key)}
              />
            );
          })}
          {note ? (
            <span className="t-caption pl-2" style={{ color: "var(--r-pea-ink)" }}>
              pea · {note}
            </span>
          ) : null}
        </div>
      </ArtifactFrame>
    </div>
  );
}
