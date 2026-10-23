import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { useAtomValue } from "@effect/atom-react";
import { Key } from "#/components/anatomy";
import type { ContextBreakdown, ContextItem } from "@pe/agent-contracts/chat-state";
import { EmptyState } from "@pe/kit/lang/empty";
import { Switcher } from "@pe/kit/lang/switcher";
import { cn } from "@pe/kit/lib/utils";
import { token } from "@pe/kit/lib/token";
import { useCurrentThreadView } from "../thread-view";
import {
  blastOf,
  BLAST_LABEL,
  cacheTotals,
  orderedLayers,
  type Blast,
  type CacheView,
} from "../world-cache";
import { Button } from "@pe/kit/lang/button";
import {
  CACHE_BASE,
  CACHE_TONE,
  CacheBadge,
  PILL_LABEL,
  PLAIN_CAP,
  WORLD_ROW,
  fmtTok,
  tone,
} from "./cap";
import { whySentence } from "./bar";
import { Code } from "@pe/kit/lang/code";
import { TooltipHint } from "@pe/kit/lang/tooltip";

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

            <Button
              label="Highlight what changed"
              pressed={diff}
              onClick={() => setWorld((previous) => ({ ...previous, diff: !previous.diff }))}
              reason={
                cache.hasBaseline && sendNumber
                  ? `Highlight what changed vs send #${sendNumber - 1}`
                  : cache.hasBaseline
                    ? "Highlight what changed since the last send"
                    : "No previous send to compare yet"
              }
              refusal={cache.hasBaseline ? null : "No previous send to compare against yet."}
            >
              Δ
            </Button>
          </div>
        </div>
      </div>

      {inspect ? (
        <div className="hairline-b-faint grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 px-3 py-1.5 t-small face-mono">
          <TooltipHint content="This breakdown was captured at the last user send; streaming pushes within the turn do not advance it">
            <span>{sendNumber ? `send #${sendNumber}` : "snapshot"}</span>
          </TooltipHint>
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

      <div className="hairline-t-faint mt-2.5">
        {layers.map((layer) => {
          const isOpen = open.has(layer.id);
          const changed = diff && cache.changed.has(layer.id);
          const blast = blastOf(layer.rank);
          return (
            <div key={layer.id} className="hairline-b-faint [&>button]:w-full">
              <Button label={layer.label} pressed={changed} onClick={() => toggle(layer.id)}>
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
              </Button>
              {isOpen ? (
                <div className="pt-0 pr-3 pb-2.5 pl-[29px] t-prose face-mono">
                  <p className="mt-0 mb-1.5 text-ink-2">{PLAIN_CAP[layer.id] ?? layer.label}</p>
                  {inspect && changed ? (
                    <p className="mt-0 mb-1.5">
                      ⚡ changed this send → {BLAST_LABEL[blast]}. {driftHint(blast)}
                    </p>
                  ) : null}
                  {inspect && layer.items.length > 0 ? (
                    <ContextItems
                      items={layer.items}
                      prefix={layer.id}
                      openItems={openItems}
                      onToggle={toggleItem}
                      blast={changed ? blast : null}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {inspect ? (
        <div className="hairline-t mt-2 px-3 pt-2 pb-3 face-mono text-ink-mute">
          {/* I6: mark plus word; the why is the hover. */}
          <TooltipHint content="Inferred from a frontend snapshot diff; the provider reports only aggregate cache totals">
            <span className={CACHE_BASE} data-tone={CACHE_TONE.cached} data-wash>
              cache ≈ inferred
            </span>
          </TooltipHint>
        </div>
      ) : null}
    </div>
  );
}

function ContextItems({
  items,
  prefix,
  openItems,
  onToggle,
  blast,
}: {
  items: readonly ContextItem[];
  prefix: string;
  openItems: ReadonlySet<string>;
  onToggle: (key: string) => void;
  blast: Blast | null;
}) {
  const list = useList({
    items,
    keyOf: (item) => `${prefix}:${items.indexOf(item)}`,
    search: (item) => ({ text: [item.name, item.src] }),
    onPick: (item) => onToggle(`${prefix}:${items.indexOf(item)}`),
    refusalOf: (item) => (item.body ? null : `${item.name} has no body to show.`),
  });
  return (
    <ListView
      list={list}
      aria-label="context items"
      empty={{ message: "No context items", exit: "Send a message" }}
      row={(item) => {
        const open = openItems.has(`${prefix}:${items.indexOf(item)}`);
        return {
          label: item.name,
          aside: item.src,
          active: open,
          meta: (
            <>
              {blast ? `${BLAST_LABEL[blast]} · ` : ""}
              {item.state ? `${PILL_LABEL[item.state]} · ` : ""}
              {item.tokens != null ? fmtTok(item.tokens) : ""}
            </>
          ),
          lines: open && item.body ? 2 : 1,
          sub: open && item.body ? <Code code={item.body} lang="plaintext" wrap /> : undefined,
        };
      }}
    />
  );
}

function driftHint(blast: Blast): string {
  if (blast === "prefix") return "A change here re-sends the entire context.";
  if (blast === "system") return "The cached tools prefix survives; system down is reprocessed.";
  return "New tail only — the cached prefix above is untouched.";
}
