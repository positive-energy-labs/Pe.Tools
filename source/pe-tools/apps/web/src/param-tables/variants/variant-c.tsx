import { token } from "#/lib/token";

/**
 * PARAM TABLES — round 1, variant C: "the deliverable is the product; the page IS M001, alive."
 *
 * THE BET — engineers think in deliverables, not databases. The page renders as the printed
 * sheet: the same exhibits that land on M001 "Calculations & Basis of Design", in print
 * typography, WYSIWYG. But values that are LINKED are alive inline: they carry footnote-style
 * provenance marks (a print-native idiom — the sheet already speaks footnotes), and clicking
 * one drills into a binding panel showing the far side — target parameter, the type-scope
 * fan-out over the 23 fan-coil tags, staged diffs, per-target refusals. Editing happens IN
 * the document; the panel is machine territory beside it. Commits append to the sheet's own
 * REVISION strip, because on a drawing that is where "what changed" already lives.
 *
 * DRILL-IN, NOT NAVIGATE: the binding panel is a mode entered from a value and left with Esc.
 * "Cameras, not scroll" is answered small here: the document is one page (M001 is one sheet);
 * the "camera" is the drill-in, not a viewport fly — noted as a limit of this variant, not a
 * disagreement with the law.
 *
 * PRINT TYPOGRAPHY DIVERGES DELIBERATELY (design-lang §5): the document region represents a
 * PRINT deliverable — serif body, uppercase tracked exhibit titles, hairline rules. It is the
 * CONTENT under review, not app chrome, so it does not borrow the app's sans/mono grammar —
 * EXCEPT where the language's laws are about meaning, which cross the print boundary intact:
 * mono still means machine-measured literals (param names, type names, sourced figures),
 * bold still means unsaved, the one alarm is still the only "model disagrees" hue, and no
 * colour literal is named — everything resolves through --pe-* tokens so the sheet re-papers
 * with the palette.
 */
import { useEffect, useState } from "react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { fmtNum, StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import {
  BOD_MAIN_HOUSE,
  FC_UNITS,
  FOM_HWCH_PLANT,
  PARAM_META,
} from "#/param-tables/variants/fixture";
import { Press } from "#/components/lang/press";

// ---------------------------------------------------------------------------
// Derived world — everything computed from the fixture, nothing remembered.
// ---------------------------------------------------------------------------

interface TypeGroup {
  typeName: string;
  tags: string[];
  /** Type-scope heating capacity (identical across siblings by construction). */
  capTotal: number;
  baseEwt: number;
  baseLwt: number;
}

/** Group the 23 tags by family TYPE — the true write target of a perf-param linkage. */
const TYPE_GROUPS: TypeGroup[] = (() => {
  const byType = new Map<string, TypeGroup>();
  for (const fc of FC_UNITS) {
    const g = byType.get(fc.typeName);
    if (g) g.tags.push(fc.tag);
    else
      byType.set(fc.typeName, {
        typeName: fc.typeName,
        tags: [fc.tag],
        capTotal: fc.heat.capTotal,
        baseEwt: fc.heat.ewt,
        baseLwt: fc.heat.lwt,
      });
  }
  return [...byType.values()];
})();

const TAG_COUNT = FC_UNITS.length;
const TYPE_COUNT = TYPE_GROUPS.length;
/** Inbound figure: Σ type-scope heating capacity × tags — sourced FROM the model. */
const TOTAL_HEAT_CAP = TYPE_GROUPS.reduce((s, g) => s + g.capTotal * g.tags.length, 0);

const BINDINGS = {
  ewt: {
    param: "PE_M_PerfHeat_FluidEWT",
    mark: "1",
    docLabel: "Heating loop supply temperature (design)",
  },
  lwt: {
    param: "PE_M_PerfHeat_FluidLWT",
    mark: "2",
    docLabel: "Heating loop return temperature (design)",
  },
} as const;
type BindingKey = keyof typeof BINDINGS;
const BINDING_KEYS: BindingKey[] = ["ewt", "lwt"];

/** Inbound (model → document) sources; read-only by construction — no commit path exists. */
const SOURCES = {
  count: { mark: "a", says: "count of tags in the Main House fan-coil schedule" },
  capacity: {
    mark: "b",
    says: "Σ PE_M_PerfHeat_CapacityDesignTotal (type scope) × tags per type",
  },
} as const;
type SourceKey = keyof typeof SOURCES;

const isReadOnly = (param: string, typeName: string): boolean =>
  PARAM_META.find((p) => p.name === param)?.readOnlyOn?.includes(typeName) ?? false;

/** The FOM grid's merged group header, derived from the fixture's row shape. */
const FOM_GROUPS: { label: string; span: number }[] = (() => {
  const out: { label: string; span: number }[] = [];
  for (const cell of FOM_HWCH_PLANT.groupRow) {
    const last = out[out.length - 1];
    if (cell === "" && last) last.span += 1;
    else out.push({ label: cell, span: 1 });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

type PanelKey = BindingKey | SourceKey | null;

interface Revision {
  n: number;
  desc: string;
  scope: string;
}
interface Receipt {
  kind: "receipt" | "refused";
  label: string;
  says: string;
}

export function VariantC() {
  /** What the model holds per type — the far substrate. Mutated only by the commit verb. */
  const [model, setModel] = useState<Record<string, { ewt: number; lwt: number }>>(() =>
    Object.fromEntries(TYPE_GROUPS.map((g) => [g.typeName, { ewt: g.baseEwt, lwt: g.baseLwt }])),
  );
  /** What the document says — the authored side of each outbound binding. */
  const [authored, setAuthored] = useState<Record<BindingKey, number>>({ ewt: 110, lwt: 100 });
  /** Which authored values carry YOUR unsaved edit (bold). Difference without an edit is drift. */
  const [edited, setEdited] = useState<Record<BindingKey, boolean>>({ ewt: false, lwt: false });
  const [open, setOpen] = useState<PanelKey>(null);
  const [editing, setEditing] = useState<BindingKey | null>(null);
  const [draft, setDraft] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditing(null);
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mv = (typeName: string, key: BindingKey): number => model[typeName]?.[key] ?? 0;

  /** The far side of one binding, recomputed each render — agreement is computed, not stored. */
  const fanout = (key: BindingKey) =>
    TYPE_GROUPS.map((g) => {
      const cur = mv(g.typeName, key);
      const to = authored[key];
      const differs = cur !== to;
      const refused = differs && isReadOnly(BINDINGS[key].param, g.typeName);
      return { g, cur, to, differs, refused, willWrite: differs && !refused };
    });

  const allRows = BINDING_KEYS.flatMap((k) => fanout(k).map((r) => ({ k, ...r })));
  const stagedWrites = allRows.filter((r) => r.willWrite);
  const stagedRefusals = allRows.filter((r) => r.refused);
  const stagedTagCount = stagedWrites.reduce((s, r) => s + r.g.tags.length, 0);

  const beginEdit = (key: BindingKey) => {
    setOpen(key);
    setEditing(key);
    setDraft(fmtNum(authored[key]));
  };

  const commitDraft = () => {
    if (editing == null) return;
    const n = Number.parseFloat(draft);
    // Skip-polish refusal: a non-number restores the prior value silently (proto only —
    // the shipped surface must restore AND say why, per SURFACE-PHILOSOPHY §3).
    if (Number.isFinite(n) && n !== authored[editing]) {
      setAuthored({ ...authored, [editing]: n });
      setEdited({ ...edited, [editing]: true });
    }
    setEditing(null);
  };

  /** The one commit verb — writes beyond the page (mock). Everything before this is staging. */
  const commitStaged = () => {
    const next = { ...model };
    const lines: Receipt[] = [];
    for (const key of BINDING_KEYS) {
      const rows = fanout(key);
      const writes = rows.filter((r) => r.willWrite);
      for (const r of writes) {
        const prev = next[r.g.typeName] ?? { ewt: r.to, lwt: r.to };
        next[r.g.typeName] = key === "ewt" ? { ...prev, ewt: r.to } : { ...prev, lwt: r.to };
      }
      if (writes.length > 0) {
        const tags = writes.reduce((s, r) => s + r.g.tags.length, 0);
        lines.push({
          kind: "receipt",
          label: `${BINDINGS[key].param} ← ${fmtNum(authored[key])} °F`,
          says: `${writes.length} types written · ${tags} tags moved`,
        });
      }
      for (const r of rows.filter((x) => x.refused)) {
        lines.push({
          kind: "refused",
          label: `${r.g.typeName} · ${BINDINGS[key].param}`,
          says: "formula-owned on this type — the family formula computes it; write refused",
        });
      }
    }
    if (lines.some((l) => l.kind === "receipt")) {
      setRevisions([
        ...revisions,
        {
          n: revisions.length + 1,
          desc: `Heating loop design temps ${fmtNum(authored.ewt)} / ${fmtNum(authored.lwt)} °F`,
          scope: `${stagedWrites.length} type writes · ${stagedTagCount} tags${
            stagedRefusals.length > 0 ? ` · ${stagedRefusals.length} refused` : ""
          }`,
        },
      ]);
    }
    setModel(next);
    setEdited({ ewt: false, lwt: false });
    setReceipts(lines);
  };

  /**
   * One live value in the document. LANG GAP: the language has no mark for "a linked literal
   * inside print prose" — cells own the grammar (StateCell) but a sheet is not a table. Built
   * raw as a print-native FOOTNOTE mark: outbound links wear ¹² in nav ink (clicking is a
   * drill-in), inbound sources wear ᵃᵇ in machine ink. Bold = unsaved crosses the print
   * boundary; the alarm squiggle on a prose value is likewise raw (StateCell owns it only at
   * cell scale).
   */
  const LiveValue = ({ k }: { k: BindingKey }) => {
    const rows = fanout(k);
    const differs = rows.some((r) => r.differs);
    if (editing === k)
      return (
        <input
          className="ptc-edit"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      );
    return (
      <Press
        type="button"
        className="ptc-live"
        data-unsaved={edited[k] ? "" : undefined}
        data-drift={differs && !edited[k] ? "" : undefined}
        title={`Linked → ${BINDINGS[k].param} (type scope, ${TYPE_COUNT} types · ${TAG_COUNT} tags). Click to edit here and see the fan-out.`}
        onClick={() => beginEdit(k)}
      >
        {fmtNum(authored[k])}
        <sup className="ptc-mark-out">{BINDINGS[k].mark}</sup>
      </Press>
    );
  };

  const SourcedValue = ({ k, children }: { k: SourceKey; children: React.ReactNode }) => (
    <Press
      type="button"
      className="ptc-sourced"
      title={`Sourced from the model: ${SOURCES[k].says}. Click to see the derivation.`}
      onClick={() => setOpen(k)}
    >
      {children}
      <sup className="ptc-mark-in">{SOURCES[k].mark}</sup>
    </Press>
  );

  return (
    <div className="ptc-root">
      <style>{CSS}</style>
      <AddressingBar
        name="param tables"
        sentence={
          <span className="ptc-sentence">
            <span className="ptc-noun">ProjectA_Clone_Aug_11</span>
            <span className="ptc-sep">›</span>
            <span className="ptc-noun">Sheet M001</span>
            <span className="ptc-sep">›</span>
            <span className="ptc-noun">exhibits A–C</span>
          </span>
        }
        facts={
          <>
            <FactChip title="Linked values on this sheet: 2 outbound (document → parameters), 2 inbound (model → document).">
              links 4
            </FactChip>
            {stagedWrites.length > 0 ? (
              <FactChip
                tone="caution"
                title="Type-level writes staged by this document. Nothing has left the page — commit from the binding panel, where the far side is visible."
              >
                staged {stagedWrites.length}
              </FactChip>
            ) : null}
            {stagedRefusals.length > 0 ? (
              <FactChip
                tone="alarm"
                title="Targets that will refuse the staged write — formula-owned parameters. The refusal is per target, with its reason, in the binding panel."
              >
                refused {stagedRefusals.length}
              </FactChip>
            ) : null}
          </>
        }
        // The page-blast verb slot stays EMPTY on purpose: the commit lives in the binding
        // panel, because "a bulk verb is disabled unless you can see its far side" (§2) — the
        // panel IS the far side, so the verb only exists where the fan-out is visible.
        seam={
          <FactChip
            dashed
            title="Fixture lane — ProjectA_Clone_Aug_11, pulled live 2026-08-17. A connected host would replace this chip with the live document."
          >
            fixture · 2026-08-17
          </FactChip>
        }
      />

      <div className="ptc-main">
        {/* ── THE DOCUMENT — the M001 sheet, WYSIWYG. ArtifactFrame is earned: the sheet is a
            machine-operated object carrying state (live values, staged edits, revisions). */}
        <div className="ptc-scroll">
          <ArtifactFrame className="ptc-paper">
            <div className="ptc-doc">
              <header className="ptc-sheethead">
                <span className="ptc-sheetproj">ProjectA_CLONE_AUG_11</span>
                <span className="ptc-sheettitle">CALCULATIONS &amp; BASIS OF DESIGN</span>
                <span className="ptc-sheetno">M001</span>
              </header>

              {/* Exhibit A — the BOD list, today a dead SXL header-cell paste; here, authored. */}
              <section>
                <h2 className="ptc-exh">EXHIBIT A — BASIS OF DESIGN · MAIN HOUSE</h2>
                <table className="ptc-bod">
                  <tbody>
                    {BOD_MAIN_HOUSE.map((e) => (
                      <tr key={e.key}>
                        <td className="ptc-bod-label">
                          {e.label}
                          {e.unit != null ? ` (${e.unit})` : ""}
                        </td>
                        <td className="ptc-bod-value">{e.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Exhibit B — the FOM plant grid, exactly as the SXL schedule renders it. */}
              <section>
                <h2 className="ptc-exh">EXHIBIT B — FIGURES OF MERIT · HWCH PLANT</h2>
                <table className="ptc-fom">
                  <thead>
                    <tr>
                      {FOM_GROUPS.map((g) => (
                        <th key={g.label} colSpan={g.span} className="ptc-fom-group">
                          {g.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {FOM_HWCH_PLANT.headRow.map((h) => (
                        <th key={h} className="ptc-fom-head">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {FOM_HWCH_PLANT.dataRow.map((d, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static fixture row
                        <td key={i} className="ptc-fom-cell">
                          {d}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <p className="ptc-footnote">{FOM_HWCH_PLANT.footnote}</p>
              </section>

              {/* Exhibit C — the live one: authored values that FLOW OUT to type parameters,
                  and figures that FLOW IN from the model. The document mixes them,
                  distinguishably: ¹² outbound (nav ink), ᵃᵇ inbound (machine mono). */}
              <section>
                <h2 className="ptc-exh">
                  EXHIBIT C — FIGURES OF MERIT · HYDRONIC TERMINAL UNITS
                  <HelpTip>
                    This exhibit is alive. Marked values are linked: ¹ ² are authored here and flow
                    out to type-scope parameters on the fan coils; ᵃ ᵇ are read from the
                    model&apos;s parameters. Click any marked value — outbound ones edit in place
                    and show their fan-out; inbound ones show their derivation.
                  </HelpTip>
                </h2>
                <table className="ptc-bod">
                  <tbody>
                    <tr>
                      <td className="ptc-bod-label">Terminal units scheduled (Main House)</td>
                      <td className="ptc-bod-value">
                        <SourcedValue k="count">
                          <span className="ptc-mono">{TAG_COUNT}</span>
                        </SourcedValue>
                      </td>
                    </tr>
                    <tr>
                      <td className="ptc-bod-label">Installed heating capacity, total (Btu/hr)</td>
                      <td className="ptc-bod-value">
                        <SourcedValue k="capacity">
                          <span className="ptc-mono">{TOTAL_HEAT_CAP.toLocaleString("en-US")}</span>
                        </SourcedValue>
                      </td>
                    </tr>
                    <tr>
                      <td className="ptc-bod-label">{BINDINGS.ewt.docLabel} (°F)</td>
                      <td className="ptc-bod-value">
                        <LiveValue k="ewt" />
                      </td>
                    </tr>
                    <tr>
                      <td className="ptc-bod-label">{BINDINGS.lwt.docLabel} (°F)</td>
                      <td className="ptc-bod-value">
                        <LiveValue k="lwt" />
                      </td>
                    </tr>
                    <tr>
                      <td className="ptc-bod-label">Cooling loop supply / return (°F)</td>
                      {/* Deliberately UNLINKED — authored dead text, so the three classes
                          (dead · outbound · inbound) are contrastable on one exhibit. */}
                      <td className="ptc-bod-value">45 / 55</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* The linked-values legend — provenance as footnotes, the sheet's own idiom. */}
              <section className="ptc-legend">
                <h3 className="ptc-legendhead">LINKED VALUES</h3>
                {BINDING_KEYS.map((k) => (
                  <p key={k} className="ptc-legendline">
                    <sup className="ptc-mark-out">{BINDINGS[k].mark}</sup>{" "}
                    <span className="ptc-mono">{BINDINGS[k].param}</span> — flows to {TYPE_COUNT}{" "}
                    types · {TAG_COUNT} tags (type scope)
                  </p>
                ))}
                {(Object.keys(SOURCES) as SourceKey[]).map((k) => (
                  <p key={k} className="ptc-legendline">
                    <sup className="ptc-mark-in">{SOURCES[k].mark}</sup> sourced from model —{" "}
                    {SOURCES[k].says}
                  </p>
                ))}
              </section>

              {/* LANG GAP: the language's receipt surface is the OutcomeLine / addressing
                  sentence; a print sheet's receipt surface is its REVISION table. Rendered raw
                  in the sheet idiom — a committed write is a revision to the deliverable. */}
              <section className="ptc-revs">
                <h3 className="ptc-legendhead">REVISIONS</h3>
                {revisions.length === 0 ? (
                  <EmptyState
                    story="scope"
                    exit="edit a linked value, then commit from the binding panel"
                  >
                    no revisions this session
                  </EmptyState>
                ) : (
                  <table className="ptc-revtable">
                    <tbody>
                      {revisions.map((r) => (
                        <tr key={r.n}>
                          <td className="ptc-rev-n">{r.n}</td>
                          <td>{r.desc}</td>
                          <td className="ptc-mono">{r.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </ArtifactFrame>
        </div>

        {/* ── THE BINDING PANEL — machine territory. Drill-in from a value; Esc leaves. */}
        {open != null ? (
          <aside className="ptc-panel">
            <ArtifactFrame
              head={
                <div className="ptc-panelhead">
                  {open === "ewt" || open === "lwt" ? (
                    <>
                      <span>{BINDINGS[open].docLabel}</span>
                      <span className="ptc-mono ptc-dim">
                        ↦ {BINDINGS[open].param} · type scope
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Sourced from model</span>
                      <span className="ptc-mono ptc-dim">↤ {SOURCES[open].says}</span>
                    </>
                  )}
                </div>
              }
              foot={
                open === "ewt" || open === "lwt" ? (
                  <div className="ptc-panelfoot">
                    <Verb
                      tone="commit"
                      label={`Write ${stagedWrites.length} staged values`}
                      reason={
                        stagedWrites.length === 0
                          ? "nothing staged — the document and the model agree on every writable target"
                          : `Writes beyond the page: ${stagedWrites.length} type-level parameter writes reaching ${stagedTagCount} tags. ${stagedRefusals.length} target(s) will refuse (formula-owned).`
                      }
                      disabled={stagedWrites.length === 0}
                      onClick={commitStaged}
                    />
                    {receipts.map((r) => (
                      <OutcomeLine key={r.label} kind={r.kind} label={r.label} says={r.says} />
                    ))}
                  </div>
                ) : undefined
              }
            >
              {open === "ewt" || open === "lwt" ? (
                <table className="ptc-fan">
                  <thead>
                    <tr>
                      <th>type</th>
                      <th>tags</th>
                      <th>model holds</th>
                      <th>after commit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fanout(open).map((r) => (
                      <tr key={r.g.typeName} data-refused={r.refused ? "" : undefined}>
                        <td className="ptc-mono">{r.g.typeName}</td>
                        <td className="ptc-mono" title={r.g.tags.join(" · ")}>
                          {r.g.tags.length}
                        </td>
                        <td className="ptc-mono">{fmtNum(r.cur)} °F</td>
                        <td>
                          {r.refused ? (
                            <StateCell
                              scale="row"
                              value={`${fmtNum(r.cur)} °F`}
                              cap="readonly"
                              capReason={`refuses — ${BINDINGS[open].param} is formula-owned on ${r.g.typeName}; the family formula computes it`}
                            />
                          ) : r.willWrite ? (
                            <StateCell
                              scale="row"
                              value={`${fmtNum(r.to)} °F`}
                              stage="staged"
                              stagedBy="you"
                              modelValue={`${fmtNum(r.cur)}`}
                            />
                          ) : (
                            <StateCell scale="row" value={`${fmtNum(r.to)} °F`} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="ptc-fan">
                  <thead>
                    <tr>
                      <th>type</th>
                      <th>tags</th>
                      {open === "capacity" ? <th>cap / unit</th> : null}
                      {open === "capacity" ? <th>subtotal</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {TYPE_GROUPS.map((g) => (
                      <tr key={g.typeName}>
                        <td className="ptc-mono">{g.typeName}</td>
                        <td className="ptc-mono" title={g.tags.join(" · ")}>
                          {g.tags.length}
                        </td>
                        {open === "capacity" ? (
                          <td className="ptc-mono">{g.capTotal.toLocaleString("en-US")}</td>
                        ) : null}
                        {open === "capacity" ? (
                          <td className="ptc-mono">
                            {(g.capTotal * g.tags.length).toLocaleString("en-US")}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    <tr className="ptc-fan-total">
                      <td>total</td>
                      <td className="ptc-mono">{TAG_COUNT}</td>
                      {open === "capacity" ? <td /> : null}
                      {open === "capacity" ? (
                        <td className="ptc-mono">{TOTAL_HEAT_CAP.toLocaleString("en-US")}</td>
                      ) : null}
                    </tr>
                  </tbody>
                </table>
              )}
            </ArtifactFrame>
            <p className="ptc-panelhint">Esc closes · values sourced live 2026-08-17 (fixture)</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles. All colour through --pe-* tokens; the PRINT look is type + rules, not hues.
// ---------------------------------------------------------------------------

const CSS = `
.ptc-root { height: 100vh; display: flex; flex-direction: column; background: ${token("page")}; --pe-on: ${token("page")}; }
.ptc-main { flex: 1; display: flex; min-height: 0; }
.ptc-scroll { flex: 1; overflow: auto; padding: 24px; }
.ptc-paper { max-width: 880px; margin: 0 auto; }
.ptc-sentence { display: inline-flex; gap: 6px; align-items: baseline; }
.ptc-noun { font-family: ui-monospace, monospace; font-size: 12px; color: ${token("ink")}; }
.ptc-sep { color: ${token("ink-mute")}; font-size: 11px; }

/* THE DOCUMENT — print typography, deliberately divergent (see file header). */
.ptc-doc { font-family: Georgia, 'Times New Roman', serif; color: ${token("ink")}; padding: 36px 48px 48px; font-size: 13.5px; line-height: 1.5; }
.ptc-sheethead { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid ${token("ink")}; padding-bottom: 8px; margin-bottom: 24px; }
.ptc-sheetproj { font-family: ui-monospace, monospace; font-size: 11px; color: ${token("ink-2")}; }
.ptc-sheettitle { font-size: 15px; letter-spacing: 0.14em; font-weight: 600; }
.ptc-sheetno { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 600; }
.ptc-exh { font-size: 12px; letter-spacing: 0.12em; font-weight: 600; margin: 26px 0 10px; border-bottom: 1px solid ${token("line")}; padding-bottom: 4px; display: flex; align-items: baseline; gap: 8px; }
.ptc-bod { width: 100%; border-collapse: collapse; }
.ptc-bod td { padding: 3px 0; vertical-align: baseline; border-bottom: 1px solid ${token("line-2")}; }
.ptc-bod-label { color: ${token("ink-2")}; padding-right: 24px; }
.ptc-bod-value { text-align: right; font-variant-numeric: tabular-nums; white-space: pre-line; max-width: 340px; }
.ptc-fom { width: 100%; border-collapse: collapse; font-size: 12px; }
.ptc-fom th, .ptc-fom td { border: 1px solid ${token("line")}; padding: 4px 6px; text-align: center; }
.ptc-fom-group { letter-spacing: 0.1em; font-size: 11px; }
.ptc-fom-head { font-weight: 400; color: ${token("ink-2")}; font-size: 11px; }
.ptc-fom-cell { font-variant-numeric: tabular-nums; }
.ptc-footnote { font-size: 11px; color: ${token("ink-2")}; font-style: italic; margin-top: 6px; }
.ptc-legend { margin-top: 28px; border-top: 1px solid ${token("line")}; padding-top: 8px; }
.ptc-legendhead { font-size: 10px; letter-spacing: 0.14em; color: ${token("ink-2")}; margin: 0 0 6px; }
.ptc-legendline { font-size: 11px; margin: 2px 0; color: ${token("ink-2")}; }
.ptc-revs { margin-top: 20px; }
.ptc-revtable { width: 100%; border-collapse: collapse; font-size: 12px; }
.ptc-revtable td { border-top: 1px solid ${token("line-2")}; padding: 3px 8px 3px 0; }
.ptc-rev-n { font-family: ui-monospace, monospace; width: 2ch; }

/* Live values in prose. LANG GAP (see LiveValue): raw marks, no canon primitive exists. */
.ptc-live, .ptc-sourced { font: inherit; color: inherit; background: none; border: none; padding: 0 2px; cursor: pointer; font-variant-numeric: tabular-nums; }
.ptc-live:hover, .ptc-sourced:hover { background: ${token("select")}; }
.ptc-live[data-unsaved] { font-weight: 700; } /* bold is reserved for unsaved — crosses the print boundary */
.ptc-live[data-drift] { text-decoration: underline wavy ${token("alarm")}; text-decoration-thickness: 1px; text-underline-offset: 3px; } /* the one alarm: a target disagrees with the sheet */
.ptc-mark-out { font-family: ui-monospace, monospace; font-size: 9px; color: ${token("nav")}; margin-left: 1px; } /* nav ink: clicking drills in */
.ptc-mark-in { font-family: ui-monospace, monospace; font-size: 9px; color: ${token("ink-2")}; margin-left: 1px; }
.ptc-edit { font: inherit; font-variant-numeric: tabular-nums; width: 6ch; text-align: right; border: 1px solid ${token("line")}; background: ${token("page")}; --pe-on: ${token("page")}; color: ${token("ink")}; padding: 0 2px; }
.ptc-mono { font-family: ui-monospace, monospace; font-size: 0.92em; }

/* The binding panel — app grammar, not print. */
.ptc-panel { width: 420px; flex-shrink: 0; overflow: auto; padding: 24px 24px 24px 0; }
.ptc-panelhead { display: flex; flex-direction: column; gap: 2px; font-size: 12px; padding: 6px 0; }
.ptc-panelfoot { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 6px 0; }
.ptc-dim { color: ${token("ink-2")}; font-size: 11px; }
.ptc-fan { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.ptc-fan th { text-align: left; font-weight: 400; color: ${token("ink-mute")}; font-size: 10.5px; padding: 4px 8px; border-bottom: 1px solid ${token("line")}; }
.ptc-fan td { padding: 3px 8px; border-bottom: 1px solid ${token("line-2")}; vertical-align: baseline; }
.ptc-fan tr[data-refused] td { color: ${token("ink-2")}; }
.ptc-fan-total td { border-top: 1px solid ${token("line")}; font-weight: 600; }
.ptc-panelhint { font-size: 10.5px; color: ${token("ink-mute")}; margin-top: 8px; text-align: right; }
`;
