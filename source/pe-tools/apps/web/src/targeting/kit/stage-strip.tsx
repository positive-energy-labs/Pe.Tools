import { token } from "#/lib/token";
import { type Product } from "#/targeting/model";
import { Press } from "#/components/lang/press";
import type { Bindings, Runner } from "./direction-glyph";
import { paneState } from "./direction-glyph";
import { PressContent } from "#/components/anatomy/press-content";

export function StageStrip<K extends string>({
  product,
  b,
  runner,
  meter = true,
  trailing,
}: {
  product: Product<K>;
  b: Bindings<K>;
  runner: Runner<K>;
  meter?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-stretch"
      role="tablist"
      style={{
        borderTop: `1px solid ${token("ink")}`,
        borderBottom: `1px solid ${token("line-2")}`,
      }}
    >
      {product.stages.map((s, i) => {
        const ready = s.verbs.filter((v) => runner.canRun(v).ok).length;
        const on = b.stage.key === s.key;
        return (
          <Press
            key={s.key}
            type="button"
            tone="quiet"
            state={on ? "selected" : "rest"}
            role="tab"
            aria-selected={on}
            onClick={() => b.setStage(s.key)}
            title={`${s.label}: ${ready} of ${s.verbs.length} verbs runnable — ${s.verbs
              .map((v) => {
                const c = runner.canRun(v);
                return c.ok ? `${v.label}: ready` : `${v.label}: ${c.reason}`;
              })
              .join(" · ")}`}
            style={{
              borderLeft: i > 0 ? `1px solid ${token("line-2")}` : undefined,
            }}
          >
            <PressContent geometry="baseline">
              <span>{s.label}</span>
              {meter ? (
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: ready === 0 ? token("ink-mute") : token("ink"),
                  }}
                >
                  {ready}/{s.verbs.length}
                </span>
              ) : null}
            </PressContent>
          </Press>
        );
      })}
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

export function PaneStrip<K extends string>({
  product,
  b,
}: {
  product: Product<K>;
  b: Bindings<K>;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="" style={{ color: token("ink-mute") }}>
        panes
      </span>
      {product.panes.map((p) => {
        const st = paneState(product, p, b);
        return (
          <span
            key={p.key}
            title={st.reason}
            className=""
            style={{
              color: st.ok ? token("ink") : token("ink-mute"),
              fontStyle: st.ok ? undefined : "italic",
              borderBottom: st.ok ? `1px solid ${token("line-2")}` : undefined,
            }}
          >
            {p.label}
          </span>
        );
      })}
    </span>
  );
}
