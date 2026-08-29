import { token } from "#/lib/token";
import { useCallback, useEffect } from "react";
import {
  pathOf,
  progress,
  targetMode,
  type Link,
  type Option,
  type Product,
} from "#/targeting/model";
import { Press } from "#/components/lang/press";
import type { Bindings, Runner } from "./direction-glyph";
import { DIR_GLYPH, POP, PULSE_CSS, freshnessWord, useClickAway } from "./direction-glyph";

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
  const close = useCallback(() => b.setOpen(null), [b.setOpen]);
  const ref = useClickAway(open, close);
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
    <span ref={ref} className="relative inline-flex items-baseline">
      <style>{PULSE_CSS}</style>
      <Press
        type="button"
        onClick={() => {
          if (!open) setLevel(link.key);
          b.setOpen(open ? null : slot);
        }}
        disabled={inert}
        title={title}
        className=""
        style={{
          padding: 0,
          cursor: inert ? "not-allowed" : "pointer",
          backgroundColor: open ? token("select") : "transparent",
          borderBottom: `1px solid ${caution ? token("caution") : token("ink")}`,
          color: caution ? token("caution") : token("ink"),
          whiteSpace: "nowrap",
          animation: lit ? "tp-pulse var(--motion-control) ease-in-out infinite" : undefined,
        }}
      >
        {link.dir ? `${DIR_GLYPH[link.dir]} ${closedText}` : closedText}
      </Press>
      {open ? (
        <span className="absolute left-0 top-full z-popup mt-1 block overflow-hidden" style={POP}>
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
                    className=""
                    style={{
                      padding: "0 3px",
                      backgroundColor: on ? token("select") : "transparent",
                      color: lab == null ? token("caution") : token("ink"),
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                b.pick(cur, hits[0].id);
                advance();
              }
              if (e.key === "Escape") b.setOpen(null);
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
          <div className="max-h-64 overflow-y-auto py-1">
            {opts === null ? (
              <div className="px-2 py-1" style={{ color: token("caution") }}>
                no legal options — needs {cur.needs}
              </div>
            ) : curFeed?.state === "error" ? (
              <div className="px-2 py-1" style={{ color: token("caution") }}>
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
                    onClick={() => {
                      b.pick(cur, o.id);
                      advance();
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
                    style={{ backgroundColor: on ? token("select") : undefined }}
                  >
                    {cur.multi ? <span className="">{on ? "☑" : "☐"}</span> : null}
                    <span className="" style={{ color: token("ink") }}>
                      {o.label}
                    </span>
                    {o.sub ? (
                      <span className="" style={{ color: token("ink-2") }}>
                        {o.sub}
                      </span>
                    ) : null}
                  </Press>
                );
              })
            )}
            {belowHits.length > 0 ? (
              <>
                <div
                  className="px-2 pt-1.5"
                  style={{ color: token("ink-mute"), borderTop: `1px solid ${token("line-2")}` }}
                >
                  {b.labelOf(cur)} › {below!.key}
                </div>
                {belowHits.map((o) => (
                  <Press
                    key={`below:${o.id}`}
                    type="button"
                    onClick={() => {
                      b.pick(below!, o.id);
                      const after = chain[chain.indexOf(below!) + 1];
                      if (after && !below!.multi) setLevel(after.key);
                      else if (!below!.multi) b.setOpen(null);
                      setQ("");
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left"
                    style={{
                      backgroundColor: b.isPicked(below!, o.id) ? token("select") : undefined,
                    }}
                  >
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
                  </Press>
                ))}
              </>
            ) : null}
            {extra?.(cur)}
          </div>
        </span>
      ) : null}
    </span>
  );
}
