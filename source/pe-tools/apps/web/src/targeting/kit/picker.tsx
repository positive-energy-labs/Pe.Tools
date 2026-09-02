import { Popover } from "@base-ui/react/popover";
import { useEffect } from "react";

import {
  pathOf,
  progress,
  targetMode,
  type Link,
  type Option,
  type Product,
} from "#/targeting/model";
import { Press } from "#/components/lang/press";
import { token } from "#/lib/token";
import type { Bindings, Runner } from "./direction-glyph";
import { DIR_GLYPH, PULSE_CSS, freshnessWord } from "./direction-glyph";
import { PressContent } from "#/components/anatomy/press-content";

export function Picker<K extends string>({
  product,
  link,
  b,
  runner,
  extra,
  inert,
}: {
  product: Product<K>;
  link: Link<K>;
  b: Bindings<K>;
  runner?: Runner<K>;
  extra?: (link: Link<K>) => React.ReactNode;
  inert?: boolean;
}) {
  const chain = pathOf(product, link.key);
  const slot = `pick:${link.key}`;
  const open = b.open === slot;
  const level = b.pickerLevel ?? link.key;
  const setLevel = b.setPickerLevel;
  const q = b.pickerQuery;
  const setQ = b.setPickerQuery;
  const p = progress(chain, b.bound, b.multi);
  useEffect(() => {
    if (!open) return;
    setLevel((p.next ?? link).key);
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lit = runner?.active.has(link.key) ?? false;
  const feed = b.feeds[link.key];
  const broken = feed?.stale || feed?.state === "error";
  const leafLabel = b.labelOf(link);
  const caution = !p.complete || broken;
  const closedText = p.complete ? (leafLabel ?? link.placeholder) : p.next!.placeholder;
  const title = [
    chain.map((l) => `${l.key}: ${b.labelOf(l) ?? "unbound"}`).join(" › "),
    `${targetMode(link)}${link.liveness ? ` · ${link.liveness}` : ""}`,
    freshnessWord(b, link),
    feed?.note ?? null,
    p.complete ? null : `needs ${p.next!.needs}`,
    feed?.seam ? `seam — needs ${feed.seam.needs}` : null,
    lit ? "in flight" : null,
  ]
    .filter(Boolean)
    .join("\n");

  const cur = chain.find((l) => l.key === level) ?? link;
  const curFeed = b.feeds[cur.key];
  const opts = b.optionsOf(cur);
  const match = (o: Option) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const hits = (opts ?? []).filter(match);
  const below = chain[chain.indexOf(cur) + 1];
  const belowHits =
    q && below && b.isBound(cur) && !cur.multi ? (b.optionsOf(below) ?? []).filter(match) : [];
  const advance = () => {
    if (cur.multi) return;
    const next = chain[chain.indexOf(cur) + 1];
    if (next) setLevel(next.key);
    else b.setOpen(null);
    setQ("");
  };

  return (
    <Popover.Root open={open} onOpenChange={(next) => b.setOpen(next ? slot : null)}>
      <span className="inline-flex items-baseline">
        <style>{PULSE_CSS}</style>
        <Popover.Trigger
          render={<Press type="button" />}
          disabled={inert}
          title={title}
          data-tone={caution ? "caution" : undefined}
          style={{
            padding: 0,
            cursor: inert ? "not-allowed" : "pointer",
            borderBottom: `1px solid ${token(caution ? "caution" : "ink")}`,
            whiteSpace: "nowrap",
            animation: lit ? "tp-pulse var(--motion-control) ease-in-out infinite" : undefined,
          }}
        >
          {link.dir ? `${DIR_GLYPH[link.dir]} ${closedText}` : closedText}
        </Popover.Trigger>
      </span>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="isolate z-popup outline-none"
        >
          <Popover.Popup
            aria-label={`Choose ${cur.key}`}
            className="block max-h-(--available-height) w-80 max-w-(--available-width) overflow-hidden rounded-lg text-ink ring-1 outline-none"
            data-surface="artifact"
          >
            <div
              className="flex flex-wrap items-baseline gap-1 px-2 pt-1.5 pb-1"
              style={{ borderBottom: `1px solid ${token("line-2")}` }}
            >
              {chain.map((l, i) => {
                const on = l.key === level;
                const lab = b.labelOf(l);
                return (
                  <span key={l.key} className="inline-flex items-baseline gap-1">
                    {i > 0 ? (
                      <span className="" style={{ color: token("ink-mute") }}>
                        ›
                      </span>
                    ) : null}
                    <Press
                      type="button"
                      onClick={() => (setLevel(l.key), setQ(""))}
                      data-selected={on ? "" : undefined}
                      data-tone={lab == null ? "caution" : undefined}
                      style={{
                        padding: "0 3px",
                        borderBottom: on ? `1px solid ${token("ink")}` : "1px solid transparent",
                      }}
                    >
                      {lab ?? l.placeholder}
                    </Press>
                  </span>
                );
              })}
            </div>

            <input
              autoFocus
              aria-label={`Search ${cur.key}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) {
                  b.pick(cur, hits[0].id);
                  advance();
                }
              }}
              placeholder={`search ${cur.key}${opts ? ` · ${opts.length}` : ""}`}
              className="w-full px-2 py-1"
              style={{
                backgroundColor: "transparent",
                borderBottom: `1px solid ${token("line-2")}`,
                outline: "none",
                color: token("ink"),
              }}
            />
            <div className="max-h-[min(16rem,calc(100dvh-6rem))] overflow-y-auto py-1">
              {opts === null ? (
                <div className="px-2 py-1" data-tone="caution">
                  no legal options — needs {cur.needs}
                </div>
              ) : curFeed?.state === "error" ? (
                <div className="px-2 py-1" data-tone="caution">
                  {curFeed.note ?? "read failed"}
                </div>
              ) : opts.length === 0 ? (
                <div className="px-2 py-1" style={{ color: token("ink-2") }}>
                  {curFeed?.state === "loading"
                    ? "reading…"
                    : cur.under && b.bound[cur.under] == null
                      ? `bind ${cur.under} first`
                      : cur.needs}
                </div>
              ) : hits.length === 0 ? (
                <div className="px-2 py-1" style={{ color: token("ink-2") }}>
                  no match
                </div>
              ) : (
                hits.map((o) => {
                  const on = b.isPicked(cur, o.id);
                  return (
                    <Press
                      key={o.id}
                      type="button"
                      tone="quiet"
                      state={on ? "selected" : "rest"}
                      onClick={() => {
                        b.pick(cur, o.id);
                        advance();
                      }}
                    >
                      <PressContent geometry="baseline">
                        {cur.multi ? <span className="">{on ? "☑" : "☐"}</span> : null}
                        <span className="" style={{ color: token("ink") }}>
                          {o.label}
                        </span>
                        {o.sub ? (
                          <span className="" style={{ color: token("ink-2") }}>
                            {o.sub}
                          </span>
                        ) : null}
                      </PressContent>
                    </Press>
                  );
                })
              )}
              {belowHits.length > 0 ? (
                <>
                  <div
                    className="px-2 pt-1.5"
                    style={{
                      color: token("ink-mute"),
                      borderTop: `1px solid ${token("line-2")}`,
                    }}
                  >
                    {b.labelOf(cur)} › {below!.key}
                  </div>
                  {belowHits.map((o) => (
                    <Press
                      key={`below:${o.id}`}
                      type="button"
                      tone="quiet"
                      state={b.isPicked(below!, o.id) ? "selected" : "rest"}
                      onClick={() => {
                        b.pick(below!, o.id);
                        const after = chain[chain.indexOf(below!) + 1];
                        if (after && !below!.multi) setLevel(after.key);
                        else if (!below!.multi) b.setOpen(null);
                        setQ("");
                      }}
                    >
                      <PressContent geometry="baseline">
                        {below!.multi ? (
                          <span className="">{b.isPicked(below!, o.id) ? "☑" : "☐"}</span>
                        ) : null}
                        <span className="" style={{ color: token("ink") }}>
                          {o.label}
                        </span>
                        {o.sub ? (
                          <span className="" style={{ color: token("ink-2") }}>
                            {o.sub}
                          </span>
                        ) : null}
                      </PressContent>
                    </Press>
                  ))}
                </>
              ) : null}
              {extra?.(cur)}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
