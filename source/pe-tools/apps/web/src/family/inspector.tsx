/**
 * Parameter inspector for /family — grafted from `/family-types`' Inspector, but every
 * fact is derived CLIENT-SIDE from the authored model instead of a host snapshot:
 *   - formula ancestry (driven by / drives) from tokenizing authored formulas with the
 *     validator's own tokenizer, so the inspector and the formula cell can never disagree,
 *   - associations from the authored solids / planes / connectors / arrays / nested that
 *     reference this parameter,
 *   - identity from where the parameter is authored (familyParameters vs sharedParameters).
 * No new contracts, no host round-trip.
 */
import { ArrowDownRight, ArrowUpRight, Link2, X } from "lucide-react";

/** What the authored model says a parameter associates through. */
export interface ParamAssociations {
  dimensions: string[];
  arrays: string[];
  nested: string[];
}

export function FamilyInspector({
  paramName,
  origin,
  dataType,
  formula,
  isInstance,
  dependsOn,
  dependents,
  associations,
  onSelect,
  onClose,
}: {
  paramName: string;
  origin: "family" | "shared";
  dataType?: string;
  formula?: string;
  isInstance?: boolean;
  dependsOn: string[];
  dependents: string[];
  associations: ParamAssociations;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const hasAssociations =
    associations.dimensions.length + associations.arrays.length + associations.nested.length > 0;

  return (
    <div className="flex h-full flex-col overflow-auto border-l border-t border-[var(--line)] bg-[var(--paper)]">
      <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] bg-[var(--paper)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold" title={paramName}>
            {paramName}
          </span>
          <IdentityBadge origin={origin} isInstance={isInstance} />
        </div>
        <button
          type="button"
          onClick={onClose}
          title="close inspector (Esc)"
          className="grid size-5 shrink-0 place-items-center rounded-[2px] text-[var(--slate)] hover:bg-[var(--paper-2)]"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-3 py-3 text-[12px]">
        <Section icon={<ArrowUpRight className="size-3.5" />} title="Driven by">
          {formula ? (
            <div className="mb-1.5 rounded-[2px] border border-[var(--line-soft)] bg-[var(--paper-2)]/50 px-2 py-1 font-mono text-[11px] text-[var(--kiln)]">
              = {formula}
            </div>
          ) : null}
          {dependsOn.length > 0 ? (
            <ChipRow names={dependsOn} onSelect={onSelect} />
          ) : formula ? null : (
            <Empty>not driven by a formula</Empty>
          )}
        </Section>

        <Section icon={<ArrowDownRight className="size-3.5" />} title="Drives">
          {dependents.length > 0 ? (
            <ChipRow names={dependents} onSelect={onSelect} />
          ) : (
            <Empty>no other parameter's formula reads it</Empty>
          )}
        </Section>

        <Section icon={<Link2 className="size-3.5" />} title="Associates through">
          {hasAssociations ? (
            <div className="flex flex-col gap-1.5">
              {associations.dimensions.length > 0 && (
                <AssocGroup label="dimensions" items={associations.dimensions} />
              )}
              {associations.arrays.length > 0 && (
                <AssocGroup label="arrays" items={associations.arrays} />
              )}
              {associations.nested.length > 0 && (
                <AssocGroup label="nested" items={associations.nested} />
              )}
            </div>
          ) : (
            <Empty>no solid, plane, connector, array, or nested reference</Empty>
          )}
        </Section>

        <div className="border-t border-[var(--line-soft)] pt-2 text-[10px] text-[var(--slate)]">
          {[dataType, origin === "shared" ? "shared" : "family-owned"].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function IdentityBadge({
  origin,
  isInstance,
}: {
  origin: "family" | "shared";
  isInstance?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className="rounded-full bg-[color-mix(in_srgb,var(--pe-blue)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--pe-blue)]"
        title={
          origin === "shared"
            ? "authored under sharedParameters — resolves by shared GUID in Revit"
            : "authored under familyParameters — family-local"
        }
      >
        {origin}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-[var(--slate)]/70">
        {isInstance ? "inst" : "type"}
      </span>
    </span>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="tele-label mb-1 flex items-center gap-1.5 text-[10px] text-[var(--slate)]">
        <span className="text-[var(--pe-blue)]">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ names, onSelect }: { names: string[]; onSelect: (name: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onSelect(name)}
          className="rounded-full border border-[var(--line-2)] px-2 py-0.5 text-[11px] hover:border-[var(--pe-blue)] hover:text-[var(--pe-blue)]"
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function AssocGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="tele-label text-[9px] text-[var(--slate)]/70">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-[2px] border border-[var(--line-soft)] bg-[var(--paper-2)]/50 px-1.5 py-0.5 font-mono text-[10px] text-[var(--slate)]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-[var(--slate)]/60">{children}</div>;
}
