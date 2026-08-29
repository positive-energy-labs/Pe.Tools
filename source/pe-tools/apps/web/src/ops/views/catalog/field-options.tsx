import { FactChip } from "#/components/lang/chip";
import { Provenance, Section } from "#/components/lang/section";
import { KVGrid } from "#/ops/primitives";
import {
  type OpViewProps,
  type OpViewRegistry,
  UnrecognizedShape,
  asRecord,
  asRecords,
  asString,
} from "#/ops/registry";
import { MonoAside, ProjectIndexView } from "./viz-cycle";
import { LoadedFamiliesView, ProjectBrowserView, SchedulesView } from "./project-browser";
import {
  ConceptEvidenceView,
  FIELD_OPTIONS_CAP,
  ParameterBindingsView,
  ParameterEvidenceView,
} from "./parameter-bindings";

export function FieldOptionsView({ data }: OpViewProps) {
  const record = asRecord(data);
  if (!record) return <UnrecognizedShape />;
  const items = asRecords(record.items);
  const mode = asString(record.mode);
  const shown = items.slice(0, FIELD_OPTIONS_CAP);

  return (
    <Section label="Field Options">
      <KVGrid
        columns={3}
        items={[
          { label: "source key", value: asString(record.sourceKey) ?? "∅" },
          { label: "mode", value: mode ?? "∅" },
          {
            label: "custom values",
            value: record.allowsCustomValue === true ? "allowed" : "not allowed",
          },
        ]}
      />
      <div className="mt-2 flex flex-wrap gap-1">
        {shown.map((item) => {
          const value = asString(item.value) ?? "∅";
          const label = asString(item.label);
          const description = asString(item.description);
          return (
            <FactChip key={value} title={[value, description].filter(Boolean).join(" — ")}>
              {label || value}
            </FactChip>
          );
        })}
        {items.length > shown.length && <MonoAside>+{items.length - shown.length} more</MonoAside>}
        {items.length === 0 && <MonoAside>no option values in this domain</MonoAside>}
      </div>
      <Provenance>
        {items.length} values in domain
        {mode === "Suggestion" ? " · suggestions, not a closed set" : ""}
        {mode === "Constraint" ? " · closed constraint set" : ""}
      </Provenance>
    </Section>
  );
}

export const views: OpViewRegistry = {
  "revit.catalog.project-index": ProjectIndexView,
  "revit.catalog.project-browser": ProjectBrowserView,
  "revit.catalog.schedules": SchedulesView,
  "revit.catalog.loaded-families": LoadedFamiliesView,
  "revit.catalog.parameter-bindings": ParameterBindingsView,
  "revit.catalog.parameter-evidence": ParameterEvidenceView,
  "revit.catalog.concept-evidence": ConceptEvidenceView,
  "revit.catalog.field-options": FieldOptionsView,
};
