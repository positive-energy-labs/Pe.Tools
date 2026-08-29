import { token } from "#/lib/token";
import type { ReactNode } from "react";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid, type KVTone, VizChip } from "#/ops/primitives";
import {
  type OpViewProps,
  UnrecognizedShape,
  asArray,
  asNumber,
  asRecord,
  asRecords,
  asString,
  text,
} from "#/ops/registry";
import {
  IssueLines,
  handleId,
  handleLabel,
  provenanceDescriptions,
} from "./views-context-kind-viz";
import { viewRangeItems } from "./views-context-document-tab";

export function ObservedViewCard({ view }: { view: Record<string, unknown> }) {
  const planViewRange = asRecord(view.planViewRange);
  const view3D = asRecord(view.view3D);
  const filters = asRecords(view.filters);
  const hiddenCategories = asRecords(view.hiddenCategories);
  const links = asRecords(view.links);
  const worksets = asRecords(view.worksets);
  const provenance = provenanceDescriptions(view.provenance);

  const stateItems: { label: string; value: ReactNode; tone?: KVTone }[] = [
    { label: "scale", value: `1:${text(view.scale)}` },
    { label: "detail level", value: text(view.detailLevel) || "∅" },
    { label: "display style", value: text(view.displayStyle) || "∅" },
    { label: "discipline", value: text(view.discipline) || "∅" },
    { label: "phase", value: text(view.phaseName) || "∅" },
    { label: "phase filter", value: text(view.phaseFilterName) || "∅" },
    {
      label: "crop box",
      value: view.cropBoxActive == null ? "∅" : view.cropBoxActive ? "active" : "off",
    },
    { label: "scope box", value: text(view.scopeBoxName) || "∅" },
    {
      label: "temp hide/isolate",
      value:
        view.temporaryHideIsolateActive == null
          ? "∅"
          : view.temporaryHideIsolateActive
            ? "ACTIVE"
            : "off",
      tone: view.temporaryHideIsolateActive === true ? "caution" : undefined,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-sm border border-line px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <VizChip viz={1} title="view kind">
          {text(view.viewType)}
        </VizChip>
        <span className="t-value min-w-0 truncate font-medium" title={text(view.title)}>
          {text(view.title)}
        </span>
        {asString(view.viewTemplateName) && (
          <FactChip title="view template applied to this view">
            {text(view.viewTemplateName)}
          </FactChip>
        )}
        {view.areGraphicsOverridesAllowed === false && (
          <FactChip tone="caution" title="graphics overrides are disallowed on this view">
            overrides disallowed
          </FactChip>
        )}
        <span className="face-mono t-caption text-ink-2">
          {text(view.candidateVisibleElementCount)} candidate visible ·{" "}
          {text(view.viewOwnedElementCount)} view-owned
        </span>
      </div>

      <Section label="graphics state">
        <KVGrid columns={3} items={stateItems} />
      </Section>

      {planViewRange && (
        <Section label="view range">
          <KVGrid columns={2} items={viewRangeItems(planViewRange)} />
        </Section>
      )}

      {view3D && (
        <Section label="3d state">
          <KVGrid
            columns={3}
            items={[
              {
                label: "projection",
                value: view3D.isPerspective === true ? "perspective" : "orthographic",
              },
              {
                label: "section box",
                value:
                  view3D.isSectionBoxActive == null
                    ? "∅"
                    : view3D.isSectionBoxActive
                      ? "active"
                      : "off",
              },
              {
                label: "locked",
                value: view3D.isLocked == null ? "∅" : view3D.isLocked ? "yes" : "no",
              },
            ]}
          />
        </Section>
      )}

      <Section label="filters" aside={<span>{filters.length}</span>}>
        {filters.length === 0 ? (
          <span className="face-mono t-caption text-ink-2">no view filters applied</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {filters.map((filter, i) => {
              const fh = asRecord(filter.handle);
              const visible = filter.isVisible;
              return (
                <FactChip
                  key={i}
                  tone={visible === false ? "caution" : "meta"}
                  title={`${text(filter.elementFilterType) || "filter"} · ${asNumber(filter.categoryCount) ?? "?"} categories`}
                >
                  {fh ? handleLabel(fh) : "?"}{" "}
                  {visible == null ? "?" : visible ? "shown" : "hidden"}
                </FactChip>
              );
            })}
          </div>
        )}
      </Section>

      <Section label="hidden categories" aside={<span>{hiddenCategories.length}</span>}>
        {hiddenCategories.length === 0 ? (
          <span className="face-mono t-caption text-ink-2">none hidden</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {hiddenCategories.map((cat, i) => {
              const ch = asRecord(cat.handle);
              return (
                <FactChip
                  key={i}
                  tone="caution"
                  title={`hidden in this view${asString(cat.categoryType) ? ` · ${text(cat.categoryType)}` : ""}`}
                >
                  {ch ? handleLabel(ch) : "?"}
                </FactChip>
              );
            })}
          </div>
        )}
      </Section>

      {links.length > 0 && (
        <Section label="links" aside={<span>{links.length}</span>}>
          <div className="flex flex-wrap gap-1">
            {links.map((link, i) => {
              const lh = asRecord(link.handle);
              const hidden = link.isHiddenInView === true;
              const unloaded = link.isLoaded === false;
              return (
                <FactChip
                  key={i}
                  tone={hidden || unloaded ? "caution" : "meta"}
                  title={text(link.linkVisibilityType) || "linked model"}
                >
                  {lh ? handleLabel(lh) : "?"}
                  {hidden && " hidden"}
                  {unloaded && " unloaded"}
                </FactChip>
              );
            })}
          </div>
        </Section>
      )}

      {worksets.length > 0 && (
        <Section label="worksets" aside={<span>{worksets.length}</span>}>
          <div className="flex flex-wrap gap-1">
            {worksets.map((workset, i) => (
              <FactChip
                key={i}
                tone={text(workset.visibility) === "Hidden" ? "caution" : "meta"}
                title="workset visibility in this view"
              >
                {text(workset.name)} {text(workset.visibility).toLowerCase()}
              </FactChip>
            ))}
          </div>
        </Section>
      )}

      {provenance.length > 0 && <Provenance>{provenance.join(" · ")}</Provenance>}
    </div>
  );
}

export function ViewRenderingStateView({ data }: OpViewProps) {
  const res = asRecord(data);
  if (!res || !Array.isArray(res.observedState)) return <UnrecognizedShape />;
  const observed = asRecords(res.observedState);
  const notInspected = asArray(res.notInspected).map(text).filter(Boolean);
  const apiLimitations = asArray(res.apiLimitations).map(text).filter(Boolean);
  const confidenceWarnings = asArray(res.confidenceWarnings).map(text).filter(Boolean);
  const nextSteps = asArray(res.likelyInspectionNextSteps).map(text).filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {observed.length === 0 ? (
        <EmptyState story="scope" exit="open a view in Revit, or name one in the request">
          no views observed
        </EmptyState>
      ) : (
        observed.map((view, i) => {
          const handle = asRecord(view.handle);
          return <ObservedViewCard key={handle ? handleId(handle) : i} view={view} />;
        })
      )}

      <Section label="evidence limits">
        {confidenceWarnings.map((warning, i) => (
          <Provenance key={`w${i}`}>
            <span style={{ color: token("caution") }}>confidence: {warning}</span>
          </Provenance>
        ))}
        {notInspected.map((item, i) => (
          <Provenance key={`n${i}`}>not inspected: {item}</Provenance>
        ))}
        {apiLimitations.map((item, i) => (
          <Provenance key={`a${i}`}>api limitation: {item}</Provenance>
        ))}
        {nextSteps.map((item, i) => (
          <Provenance key={`s${i}`}>next: {item}</Provenance>
        ))}
        {notInspected.length + apiLimitations.length + confidenceWarnings.length === 0 && (
          <Provenance>no limitations reported by the host for this observation</Provenance>
        )}
      </Section>
      <IssueLines issues={res.issues} />
    </div>
  );
}

export function ScoreBar({ score, max, muted }: { score: number; max: number; muted: boolean }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`score ${score} of max ${max} in this set`}
    >
      <span className="inline-block h-[3px] w-[72px] rounded-[1px] bg-line">
        <span
          className="block h-full rounded-[1px]"
          style={{
            width: `${frac * 100}%`,
            backgroundColor: muted ? token("ink-mute") : token("viz-1"),
          }}
        />
      </span>
      <span
        className="face-mono t-caption"
        style={{ color: muted ? token("ink-mute") : undefined }}
      >
        {score}
      </span>
    </span>
  );
}
