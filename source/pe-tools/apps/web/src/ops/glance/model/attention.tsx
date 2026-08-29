import { token } from "#/lib/token";
import { FactChip } from "#/components/lang/chip";
import { CoverageBar } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, VizChip } from "#/ops/primitives";
import { UnrecognizedShape, asNumber, asRecord, asRecords, asString, text } from "#/ops/registry";
import type { SyntheticOp, SyntheticViewProps } from "#/ops/synthetic";
import { MonoAside, composition, obs } from "./viz-cycle";
import { ModelGlanceView } from "./summary";

export function AttentionGlanceView({ results, observedAtMs }: SyntheticViewProps) {
  const res = asRecord(results["revit.glance.attention"]);
  if (!res) return <UnrecognizedShape />;

  const observedAtUtc = asString(res.observedAtUtc);
  const activeView = asRecord(res.activeView);
  const sheetPlacements = activeView ? asRecords(activeView.sheetPlacements) : [];
  const viewState = asRecord(res.viewState);
  const visibleCategories = asRecords(res.visibleCategories);
  const totalVisible = asNumber(res.totalVisibleElementCount);
  const issues = asRecords(res.issues);
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
  const confidenceWarnings = strings(res.confidenceWarnings);
  const apiLimitations = strings(res.apiLimitations);
  const notInspected = strings(res.notInspected);

  const visibleComposition = composition(
    visibleCategories.map((cat) => {
      const handle = asRecord(cat.handle);
      return {
        name: (handle && asString(handle.label)) ?? "unknown category",
        count: asNumber(cat.elementCount) ?? 0,
      };
    }),
    8,
  );

  const limitAdjusted = issues.filter(
    (issue) => asString(issue.code) === "AgentContextRequestLimitAdjusted",
  );

  return (
    <div className="flex flex-col gap-5">
      {!activeView ? (
        <EmptyState story="scope" exit="open a view in the connected Revit session">
          no active view reported
        </EmptyState>
      ) : (
        <div className="min-w-0 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="min-w-0 truncate" title={text(activeView.title)}>
              {text(activeView.title)}
            </span>
            <VizChip viz={activeView.isSheet === true ? 2 : 1} title="view kind">
              {text(activeView.viewType)}
            </VizChip>
            {activeView.isTemplate === true && (
              <FactChip
                tone="caution"
                title="this is a view template, not a model view — trust nothing spatial"
              >
                view template
              </FactChip>
            )}
            <MonoAside>1:{text(activeView.scale)}</MonoAside>
            {sheetPlacements.map((p, i) => (
              <span
                key={i}
                className=""
                style={{
                  color: p.isActiveSheet === true ? token("ink") : token("ink-2"),
                }}
                title={p.isActiveSheet === true ? "this is the active sheet" : undefined}
              >
                sheet {text(p.sheetNumber)} · {text(p.sheetName)}
              </span>
            ))}
          </div>
          {viewState && (
            <div className="mt-2">
              <KVGrid
                columns={3}
                items={[
                  { label: "display style", value: text(viewState.displayStyle) },
                  { label: "detail level", value: text(viewState.detailLevel) },
                  {
                    label: "candidate visible elements",
                    value: text(viewState.candidateVisibleElementCount),
                  },
                  { label: "view-owned elements", value: text(viewState.viewOwnedElementCount) },
                  {
                    label: "temporary hide/isolate",
                    value: viewState.temporaryHideIsolateActive === true ? "ACTIVE" : "off",
                    tone: viewState.temporaryHideIsolateActive === true ? "caution" : undefined,
                  },
                  {
                    label: "crop box",
                    value: viewState.cropBoxActive === true ? "active" : "off",
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <Section
        label="visible elements by category"
        aside={totalVisible !== undefined && <MonoAside>{totalVisible} visible elements</MonoAside>}
      >
        {visibleComposition.length === 0 || (totalVisible ?? 1) <= 0 ? (
          <EmptyState story="scope" exit="unhide something, or open a view that shows the model">
            0 visible elements reported in the active view
          </EmptyState>
        ) : (
          <>
            <CoverageBar segments={visibleComposition} total={totalVisible} />
            {limitAdjusted.length > 0 && (
              <Provenance>
                host adjusted limits: {limitAdjusted.map((i) => text(i.message)).join(" / ")} · obs{" "}
                {obs(observedAtUtc, observedAtMs)}
              </Provenance>
            )}
          </>
        )}
      </Section>

      <Section label="can pea trust this view?">
        <div className="flex flex-col gap-2">
          {confidenceWarnings.length === 0 ? (
            <MonoAside>0 confidence warnings from the rendering-state probe</MonoAside>
          ) : (
            <ul className="flex flex-col gap-1">
              {confidenceWarnings.map((warning, i) => (
                <li key={i} className="" style={{ color: token("caution") }}>
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {apiLimitations.length > 0 && (
            <div>
              <div className="mb-1" style={{ color: token("caution") }}>
                api limitations (verbatim)
              </div>
              <ul className="flex flex-col gap-1">
                {apiLimitations.map((limitation, i) => (
                  <li key={i} className="" style={{ color: token("caution") }}>
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notInspected.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none">
                {notInspected.length} things this packet did NOT inspect
              </summary>
              <ul className="mt-1 flex flex-col gap-1 pl-3">
                {notInspected.map((item, i) => (
                  <li key={i} className="">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Section>

      <Provenance>
        one bounded revit.glance.attention packet; trust strip quoted verbatim · obs{" "}
        {obs(observedAtUtc, observedAtMs)} (host clock)
      </Provenance>
    </div>
  );
}

export const modelGlanceOps: SyntheticOp[] = [
  {
    key: "glance.model",
    displayName: "Model at a glance",
    blurb: "What IS this model — how big, what discipline, what shape is it in?",
    contractNote:
      "First-class since ADR 0003: one revit.glance.model packet replaced the 4-call client fan-out (3 truncation dialects).",
    deps: [{ key: "revit.glance.model" }],
    View: ModelGlanceView,
  },
  {
    key: "glance.attention",
    displayName: "What the user sees",
    blurb: "What is on the user's screen right now, and can pea trust it?",
    contractNote:
      "First-class since ADR 0003: one revit.glance.attention packet replaced the 3-call fan-out; limits are host-owned and never clamp to the minimum.",
    deps: [{ key: "revit.glance.attention" }],
    View: AttentionGlanceView,
  },
];
