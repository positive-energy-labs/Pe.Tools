/**
 * PROTOTYPE — paradigm "plugin": every product as a chat card. Throwaway with the round.
 *
 * The page is a mock chat thread. Each product is a PLUGIN CARD in the conversation:
 * the card head carries the targeting (bindings, compact), the body shows the mounted
 * stage's verbs as what pea could do next, and a pea message above each card narrates
 * the workflow moment. The bet: the chat card is the smallest surface the targeting
 * grammar must fit — if it works here, it works anywhere. Pea is the marked case
 * (var(--r-pea-ink)); the human is the ground. Nothing writes — verbs are mock.
 */
import { useState } from "react";

import {
  annotation,
  annotationColor,
  demandedKeys,
  PRODUCTS,
  type MockNoun,
  type MockProduct,
  type MockStage,
} from "#/targeting-proto/model";

/* ---------------------------------------------------------------- binding state */

interface BindState {
  single: Record<string, string | null>;
  multi: Record<string, Set<string>>;
}

function boundLabel(noun: MockNoun, state: BindState): string | null {
  if (noun.multi) {
    const picked = state.multi[noun.key];
    return picked && picked.size > 0
      ? `${picked.size} of ${noun.options.length} ${noun.key}`
      : null;
  }
  return state.single[noun.key] ?? noun.label;
}

/* ---------------------------------------------------------------- pea narration */

/** Derive pea's message above a card from the fixture only — no invented semantics. */
function narrate(product: MockProduct, stage: MockStage, state: BindState): string {
  const demanded = demandedKeys(stage);
  const nouns = [...product.nouns].sort((a, b) => a.rank - b.rank);
  const relevant = nouns.filter((n) => demanded.has(n.key));
  const bound = relevant.filter((n) => boundLabel(n, state) !== null);
  const missing = relevant.filter((n) => boundLabel(n, state) === null);
  const verbs = stage.verbs.map((v) => v.label).join(" or ");

  if (relevant.length === 0)
    return `Nothing needs binding to ${verbs} in ${product.name} — just talk.`;
  if (missing.length > 0) {
    const have =
      bound.length > 0
        ? `${bound.map((n) => boundLabel(n, state)).join(", ")} ${bound.length === 1 ? "is" : "are"} set, but `
        : "";
    return `We're at ${stage.label} in ${product.name} — ${have}before I can ${verbs} I still need you to ${missing
      .map((n) => n.placeholder)
      .join(" and ")}.`;
  }
  return `${bound.map((n) => boundLabel(n, state)).join(", ")} — ${product.name} is ready to ${verbs}. Want me to?`;
}

/* ---------------------------------------------------------------- chat chrome */

function PeaTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 pr-16">
      <span
        className="t-caption t-upper mt-0.5 shrink-0"
        style={{ color: "var(--r-pea-ink)" }}
      >
        pea
      </span>
      <div className="t-label" style={{ color: "var(--r-ink)", maxWidth: "48rem" }}>
        {children}
      </div>
    </div>
  );
}

function UserTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end pl-16">
      <div
        className="t-label px-2.5 py-1.5"
        style={{
          color: "var(--r-ink)",
          border: "0.5px solid var(--r-line-2)",
          borderRadius: 2,
          maxWidth: "36rem",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- plugin card */

function PluginCard({ product }: { product: MockProduct }) {
  const [stageKey, setStageKey] = useState(product.stages[0]!.key);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [single, setSingle] = useState<Record<string, string | null>>({});
  const [multi, setMulti] = useState<Record<string, Set<string>>>({});
  const [mockReply, setMockReply] = useState<string | null>(null);

  const state: BindState = { single, multi };
  const stage = product.stages.find((s) => s.key === stageKey) ?? product.stages[0]!;
  const demanded = demandedKeys(stage);
  const ordered = [...product.nouns].sort((a, b) => a.rank - b.rank);
  const missing = ordered.filter(
    (n) => demanded.has(n.key) && boundLabel(n, state) === null,
  );

  const pick = (noun: MockNoun, id: string) => {
    if (noun.multi) {
      setMulti((prev) => {
        const next = new Set(prev[noun.key] ?? []);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...prev, [noun.key]: next };
      });
    } else {
      const opt = noun.options.find((o) => o.id === id);
      setSingle((prev) => ({ ...prev, [noun.key]: opt?.label ?? null }));
      setOpenSlot(null);
    }
  };
  const isPicked = (noun: MockNoun, id: string) =>
    noun.multi
      ? (multi[noun.key] ?? new Set()).has(id)
      : boundLabel(noun, state) === noun.options.find((o) => o.id === id)?.label;

  const openNoun = ordered.find((n) => n.key === openSlot) ?? null;

  return (
    <div className="flex flex-col gap-2">
      {/* pea narrates the workflow moment above the card */}
      <PeaTurn>{narrate(product, stage, state)}</PeaTurn>

      <div
        className="ml-8"
        style={{ border: "0.5px solid var(--r-line-2)", borderRadius: 2, maxWidth: "44rem" }}
      >
        {/* ---- card head: plugin identity + compact targeting ---- */}
        <div
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2.5 py-1.5"
          style={{ borderBottom: "0.5px solid var(--r-line)" }}
        >
          <span className="t-caption t-upper" style={{ color: "var(--r-pea-ink)" }}>
            {product.name}
          </span>
          {ordered.map((noun) => {
            const label = boundLabel(noun, state);
            const dimmed = !demanded.has(noun.key);
            return (
              <span
                key={noun.key}
                className="flex items-baseline gap-1"
                style={{ opacity: dimmed ? 0.4 : 1, whiteSpace: "nowrap" }}
              >
                <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                  {noun.joiner}
                </span>
                <button
                  type="button"
                  title={`${annotation(noun)} — ${noun.empty}`}
                  onClick={() => setOpenSlot(openSlot === noun.key ? null : noun.key)}
                  className="face-mono t-caption"
                  style={{
                    padding: 0,
                    cursor: "pointer",
                    background: openSlot === noun.key ? "var(--r-select)" : "transparent",
                    border: "none",
                    borderBottom: `0.5px solid ${label ? "var(--r-ink)" : "var(--r-caution)"}`,
                    borderRadius: 0,
                    color: label ? "var(--r-ink)" : "var(--r-caution)",
                  }}
                >
                  {label ?? noun.placeholder}
                </button>
                <span
                  className="t-caption t-upper"
                  style={{ color: annotationColor(noun), fontSize: 8, lineHeight: "10px" }}
                >
                  {annotation(noun)}
                </span>
              </span>
            );
          })}
        </div>

        {/* ---- inline options picker (expands inside the card, not a popover) ---- */}
        {openNoun ? (
          <div className="px-2.5 py-1.5" style={{ borderBottom: "0.5px solid var(--r-line)" }}>
            <div className="t-caption t-upper pb-0.5" style={{ color: "var(--r-ink-2)" }}>
              {openNoun.placeholder} · {annotation(openNoun)}
              {openNoun.multi ? " · pick many" : ""}
            </div>
            {openNoun.options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(openNoun, o.id)}
                className="flex w-full items-baseline gap-1.5 py-0.5 text-left"
                style={{
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                  borderTop: "0.5px solid var(--r-line)",
                  padding: "2px 0",
                }}
              >
                {openNoun.multi ? (
                  <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {isPicked(openNoun, o.id) ? "☑" : "☐"}
                  </span>
                ) : null}
                <span
                  className="face-mono t-caption"
                  style={{
                    color: "var(--r-ink)",
                    background:
                      !openNoun.multi && isPicked(openNoun, o.id)
                        ? "var(--r-select)"
                        : "transparent",
                  }}
                >
                  {o.label}
                </span>
                {o.sub ? (
                  <span className="face-mono t-caption" style={{ color: "var(--r-ink-2)" }}>
                    {o.sub}
                  </span>
                ) : null}
              </button>
            ))}
            {openNoun.options.length === 0 ? (
              <div className="face-mono t-caption py-1" style={{ color: "var(--r-ink-2)" }}>
                {openNoun.empty}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- pea's ask: demanded-but-unbound renders as pea asking inside the card ---- */}
        {missing.length > 0 ? (
          <div
            className="flex items-baseline gap-2 px-2.5 py-1"
            style={{ borderBottom: "0.5px solid var(--r-line)" }}
          >
            <span className="t-caption t-upper shrink-0" style={{ color: "var(--r-pea-ink)" }}>
              pea asks
            </span>
            <span className="t-caption" style={{ color: "var(--r-caution)" }}>
              {missing.map((n) => `${n.placeholder} — ${n.empty}`).join("; ")}
            </span>
          </div>
        ) : null}

        {/* ---- card body: stage scrubber + what pea could do next ---- */}
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
          {product.stages.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStageKey(s.key);
                setMockReply(null);
              }}
              className="face-mono t-caption px-1.5 py-0.5"
              style={{
                cursor: "pointer",
                background: s.key === stage.key ? "var(--r-select)" : "transparent",
                border: "0.5px solid var(--r-line-2)",
                borderRadius: 2,
                color: "var(--r-ink)",
              }}
            >
              {s.label}
            </button>
          ))}
          <span className="t-caption t-upper px-1" style={{ color: "var(--r-ink-2)" }}>
            pea could
          </span>
          {stage.verbs.map((v) => {
            const blocked = v.demands.filter(
              (k) => boundLabel(product.nouns.find((n) => n.key === k)!, state) === null,
            );
            return (
              <button
                key={v.key}
                type="button"
                title={
                  blocked.length > 0
                    ? `needs ${blocked.join(", ")} bound first`
                    : "mock — nothing writes in this prototype, so no write-beyond-page blue"
                }
                onClick={() =>
                  blocked.length === 0 &&
                  setMockReply(
                    `I'd run "${v.label}" against ${v.demands.length > 0 ? v.demands.join(" + ") : "nothing bound"} — mock only, nothing writes.`,
                  )
                }
                className="face-mono t-caption px-1.5 py-0.5"
                style={{
                  cursor: blocked.length > 0 ? "not-allowed" : "pointer",
                  opacity: blocked.length > 0 ? 0.4 : 1,
                  background: "transparent",
                  border: "0.5px solid var(--r-line-2)",
                  borderRadius: 2,
                  color: "var(--r-ink)",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* ---- ephemeral mock reply from pea when a verb is pressed ---- */}
        {mockReply ? (
          <div
            className="flex items-baseline gap-2 px-2.5 py-1"
            style={{ borderTop: "0.5px solid var(--r-line)" }}
          >
            <span className="t-caption t-upper shrink-0" style={{ color: "var(--r-pea-ink)" }}>
              pea
            </span>
            <span className="t-caption" style={{ color: "var(--r-ink-2)" }}>
              {mockReply}
            </span>
          </div>
        ) : null}
      </div>

      {/* fixture seam: the stress line, dashed = fixture only */}
      <div
        className="ml-8 t-caption face-mono px-2.5 py-0.5"
        style={{
          color: "var(--r-ink-2)",
          border: "0.5px dashed var(--r-line-2)",
          borderRadius: 2,
          maxWidth: "44rem",
        }}
      >
        {product.stress}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the thread */

export function PluginParadigm() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-3 py-4">
      <div className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
        PROTOTYPE — paradigm "plugin" · every product as a chat card · throwaway
      </div>
      <UserTurn>where are we across everything?</UserTurn>
      <PeaTurn>
        Here's every product in play — each card carries its own targeting. Scrub a stage
        to see what I could do next; anything underlined is a binding you can change.
      </PeaTurn>
      {PRODUCTS.map((p) => (
        <PluginCard key={p.key} product={p} />
      ))}
    </div>
  );
}
