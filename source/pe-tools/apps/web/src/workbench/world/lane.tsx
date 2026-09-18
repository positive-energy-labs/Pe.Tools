import { useAtomValue } from "@effect/atom-react";
import { Key } from "#/components/anatomy";
import type { ContextBreakdown, ContextItem } from "../chat-state";
import { EmptyState } from "#/components/lang/empty";
import { Switcher } from "#/components/lang/switcher";
import { cn } from "#/lib/utils";
import { token } from "#/lib/token";
import { useCurrentThreadView } from "../thread-view";
import {
  blastOf,
  BLAST_LABEL,
  cacheTotals,
  orderedLayers,
  type Blast,
  type CacheView,
} from "../world-cache";
import { Press } from "#/components/lang/press";
import {
  BLAST_BASE,
  BLAST_TONE,
  CACHE_BASE,
  CACHE_TONE,
  CacheBadge,
  PILL_BASE,
  PILL_LABEL,
  PILL_TONE,
  PLAIN_CAP,
  WORLD_ROW,
  fmtTok,
  tone,
} from "./cap";
import { ContextBudgetBar, whySentence } from "./bar";
import { PressContent } from "#/components/anatomy/press-content";
import { Code } from "#/components/lang/code";

export function SessionStrip({
  breakdown,
  cache,
  sendNumber,
}: {
  breakdown: ContextBreakdown | undefined;
  cache: CacheView;
  sendNumber?: number;
}) {
  const view = useCurrentThreadView();
  const { density, diff, open, openItems } = useAtomValue(view.atoms.world);
  const setWorld = view.actions.setWorld;
  const inspect = density === "inspect";
  const layers = orderedLayers(breakdown);
  const used = layers.reduce((sum, layer) => sum + layer.tokens, 0) || 1;
  const totals = cacheTotals(layers, cache);

  if (layers.length === 0) {
    return (
      <div className="flex min-h-0 flex-col px-4 py-5">
        <EmptyState story="scope" exit="ask pea something — the first send populates the context">
          nothing sent to the model yet
        </EmptyState>
      </div>
    );
  }

  const toggle = (id: string) =>
    setWorld((previous) => {
      const next = new Set(previous.open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...previous, open: next };
    });
  const toggleItem = (key: string) =>
    setWorld((previous) => {
      const next = new Set(previous.openItems);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...previous, openItems: next };
    });

  return (
    <div className="flex min-h-0 flex-col t-small t-upper text-ink-2">
      <div className="hairline-y sticky top-0 z-[2] grid gap-1.5 px-3 py-2" data-surface="page">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 t-small t-upper text-ink">Context ledger</h2>
          <span className="ml-auto t-small face-mono text-ink-2">{fmtTok(used)} loaded</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate t-small face-mono">
            what pea sends the model · request order
          </span>
          <div className="ml-auto flex flex-none items-center gap-1.5">
            <Switcher
              ariaLabel="density"
              value={density}
              onChange={(density) => setWorld((previous) => ({ ...previous, density }))}
              options={[
                {
                  value: "plain",
                  label: "Plain",
                  title: "Lay-reader view — layer names and what each one is, no dev chrome",
                },
                {
                  value: "inspect",
                  label: "Inspect",
                  title: "Dev view — tokens, shares, cache state, budget bar, item bodies",
                },
              ]}
            />

            <Press
              type="button"
              tone="quiet"
              size="icon"
              state="selected"
              aria-pressed={diff}
              onClick={() => setWorld((previous) => ({ ...previous, diff: !previous.diff }))}
              title={
                cache.hasBaseline && sendNumber
                  ? `Highlight what changed vs send #${sendNumber - 1}`
                  : cache.hasBaseline
                    ? "Highlight what changed since the last send"
                    : "No previous send to compare yet"
              }
              disabled={!cache.hasBaseline}
            >
              Δ
            </Press>
          </div>
        </div>
      </div>

      {inspect ? (
        <div className="hairline-b-faint grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 px-3 py-1.5 t-small face-mono">
          <span title="This breakdown was captured at the last user send; streaming pushes within the turn do not advance it">
            {sendNumber ? `send #${sendNumber}` : "snapshot"}
          </span>
          <span className="truncate text-right text-ink-mute">live agent · resolved snapshot</span>
        </div>
      ) : null}

      {inspect && cache.hasBaseline ? (
        <div className="hairline-b-faint grid gap-1 px-3 py-2 t-small face-mono">
          <div className="mb-0.5 t-upper text-ink">Cache estimate</div>
          <div className="grid grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-1.5">
            <span
              className="size-[9px]"
              data-tone="done"
              style={{ backgroundColor: "currentColor" }}
            />
            <span>cache-read · 0.1×</span>
            <span>{fmtTok(totals.cached)}</span>
          </div>
          <div className="grid grid-cols-[9px_minmax(0,1fr)_auto] items-center gap-1.5">
            <span className="col-span-2">
              <Key tone={token("caution")} label="reprocessed · 1×" seam />
            </span>
            <span>{fmtTok(totals.reprocessed)}</span>
          </div>
          {diff && cache.changed.size > 0 && cache.horizonRank !== null ? (
            <div
              className="mt-0.5 border-l-2 pl-2"
              data-tone="caution"
              style={{ borderColor: "currentColor" }}
            >
              Δ this send: {whySentence(layers, cache, totals.reprocessed)}
            </div>
          ) : null}
        </div>
      ) : null}

      {inspect && breakdown ? <ContextBudgetBar breakdown={breakdown} cache={cache} /> : null}

      <div className="hairline-t-faint mt-2.5">
        {layers.map((layer) => {
          const isOpen = open.has(layer.id);
          const changed = diff && cache.changed.has(layer.id);
          const blast = blastOf(layer.rank);
          return (
            <div key={layer.id} className="hairline-b-faint [&>button]:w-full">
              <Press
                tone="quiet"
                state={changed ? "selected" : "rest"}
                type="button"
                onClick={() => toggle(layer.id)}
              >
                <span
                  className={cn(
                    WORLD_ROW,
                    inspect
                      ? "grid-cols-[9px_minmax(0,1fr)_46px_32px_28px_10px]"
                      : "grid-cols-[9px_minmax(0,1fr)_10px]",
                  )}
                >
                  <span className="size-[9px]" style={{ backgroundColor: tone(layer.id) }} />
                  <span className="min-w-0 truncate text-ink">
                    {layer.label}
                    {inspect ? (
                      <span className="ml-1.5 t-small face-mono text-ink-2">pos {layer.rank}</span>
                    ) : null}
                  </span>
                  {inspect ? (
                    <span className="flex w-[46px] justify-end">
                      <CacheBadge state={cache.stateOf(layer.id)} />
                    </span>
                  ) : null}
                  {inspect ? (
                    <span className="w-8 text-right t-small face-mono">{fmtTok(layer.tokens)}</span>
                  ) : null}
                  {inspect ? (
                    <span className="w-7 text-right t-small face-mono">
                      {((layer.tokens / used) * 100).toFixed(0)}%
                    </span>
                  ) : null}
                  <span
                    className={cn("w-2.5 text-right transition-transform", isOpen && "rotate-90")}
                  >
                    ▸
                  </span>
                </span>
              </Press>
              {isOpen ? (
                <div className="pt-0 pr-3 pb-2.5 pl-[29px] t-prose face-mono">
                  <p className="mt-0 mb-1.5 text-ink-2">{PLAIN_CAP[layer.id] ?? layer.label}</p>
                  {inspect && changed ? (
                    <p className="mt-0 mb-1.5">
                      ⚡ changed this send → {BLAST_LABEL[blast]}. {driftHint(blast)}
                    </p>
                  ) : null}
                  {inspect && layer.items.length > 0 ? (
                    <ul className="m-0 grid list-none gap-[5px] p-0">
                      {layer.items.map((item, index) => (
                        <ItemRow
                          key={index}
                          item={item}
                          open={openItems.has(`${layer.id}:${index}`)}
                          onToggle={() => toggleItem(`${layer.id}:${index}`)}
                          blast={changed ? blast : null}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {inspect ? (
        <div className="hairline-t mt-2 px-3 pt-2 pb-3 t-prose face-mono text-ink-mute">
          cache state{" "}
          <span className={CACHE_BASE} data-tone={CACHE_TONE.cached} data-wash>
            ≈ inferred
          </span>{" "}
          from a frontend snapshot diff — the provider only reports aggregate cache totals.
        </div>
      ) : null}
    </div>
  );
}

export function ItemRow({
  item,
  open,
  onToggle,
  blast,
}: {
  item: ContextItem;
  open: boolean;
  onToggle: () => void;
  blast: Blast | null;
}) {
  const hasBody = Boolean(item.body);
  return (
    <li className="overflow-hidden [&>button]:w-full">
      <Press type="button" tone="quiet" disabled={!hasBody} onClick={() => hasBody && onToggle()}>
        <PressContent geometry="baseline">
          <span className="min-w-0 flex-1 t-small face-mono">
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
              {item.name}
            </span>
            {item.src ? (
              <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap">
                {item.src}
              </span>
            ) : null}
          </span>
          <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap t-small face-mono">
            {blast ? (
              <span
                className={cn(
                  BLAST_BASE,
                  !BLAST_TONE[blast] && "hairline-x-faint hairline-y-faint text-ink-2",
                )}
                data-tone={BLAST_TONE[blast]}
                data-wash={BLAST_TONE[blast] ? "" : undefined}
              >
                {BLAST_LABEL[blast]}
              </span>
            ) : null}
            {item.state ? (
              <span className={`${PILL_BASE} ${PILL_TONE[item.state]}`}>
                {PILL_LABEL[item.state]}
              </span>
            ) : null}
            {item.tokens != null ? <span>{fmtTok(item.tokens)}</span> : null}
            {hasBody ? (
              <span className={cn("transition-transform", open && "rotate-90")}>▸</span>
            ) : null}
          </span>
        </PressContent>
      </Press>
      {open && item.body ? <Code code={item.body} lang="plaintext" wrap /> : null}
    </li>
  );
}

export function driftHint(blast: Blast): string {
  if (blast === "prefix") return "A change here re-sends the entire context.";
  if (blast === "system") return "The cached tools prefix survives; system down is reprocessed.";
  return "New tail only — the cached prefix above is untouched.";
}
