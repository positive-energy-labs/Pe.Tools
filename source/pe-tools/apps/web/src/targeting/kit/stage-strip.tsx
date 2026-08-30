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
    <div className="flex items-stretch" role="tablist">
      {product.stages.map((s) => {
        const ready = s.verbs.filter((v) => runner.canRun(v).ok).length;
        const on = b.stage.key === s.key;
        return (
          <Press
            key={s.key}
            type="button"
            tone="quiet"
            size="caption"
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
          >
            <PressContent geometry="baseline">
              <span className="face-mono t-upper">{s.label}</span>
              {meter ? (
                <span className={`face-mono t-upper ${ready === 0 ? "text-ink-mute" : "text-ink"}`}>
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
      <span className="face-mono t-caption t-upper text-ink-mute">panes</span>
      {product.panes.map((p) => {
        const st = paneState(product, p, b);
        return (
          <span
            key={p.key}
            title={st.reason}
            className={st.ok ? "face-mono t-caption text-ink" : "face-mono t-caption text-ink-mute"}
          >
            {p.label}
          </span>
        );
      })}
    </span>
  );
}
