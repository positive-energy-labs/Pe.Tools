import { ArrowDownRight, ArrowUpRight, Link2, X } from "lucide-react";

import type { FamilyTypesParam, ParameterIdentity } from "@pe/agent-contracts";

import { useFamilyTypes } from "#/family-types/store";
import { cn } from "#/lib/utils";

/**
 * The parameter inspector (bottom-right): for the selected parameter, the formula
 * ancestry — "driven by" (dependsOn + formula), "drives" (dependents) — and the
 * geometry it associates through (dimensions / arrays / nested). Dependency chips
 * select that parameter in the grid. An identity badge names its resolution kind.
 */
export function Inspector({
  paramName,
  onSelect,
  onClose,
}: {
  paramName: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const { document } = useFamilyTypes();
  const param = document.snapshot?.parameters.find((p) => p.name === paramName);
  if (!param) return null;

  const associations = param.associations;
  const hasAssociations =
    !!associations &&
    (associations.dimensions.length || associations.arrays.length || associations.nested.length);

  return (
    <div className="flex h-full flex-col overflow-auto border-l border-t border-[var(--line)] bg-[var(--paper)]">
      <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-[var(--line-soft)] bg-[var(--paper)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold" title={param.name}>
            {param.name}
          </span>
          <IdentityBadge identity={param.identity ?? null} isInstance={param.isInstance} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
          title="close inspector"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-3 py-3 text-[12px]">
        <Section icon={<ArrowUpRight className="size-3.5" />} title="Driven by">
          {param.formula ? (
            <div className="mb-1.5 rounded-sm border border-[var(--line-soft)] bg-[var(--paper-2)] px-2 py-1 font-mono text-[11px] text-foreground">
              {param.formula}
            </div>
          ) : null}
          {param.dependsOn?.length ? (
            <ChipRow names={param.dependsOn} onSelect={onSelect} />
          ) : param.formula ? null : (
            <Empty>not driven by a formula</Empty>
          )}
        </Section>

        <Section icon={<ArrowDownRight className="size-3.5" />} title="Drives">
          {param.dependents?.length ? (
            <ChipRow names={param.dependents} onSelect={onSelect} />
          ) : (
            <Empty>no other parameter's formula reads it</Empty>
          )}
        </Section>

        <Section icon={<Link2 className="size-3.5" />} title="Associates through">
          {hasAssociations && associations ? (
            <div className="flex flex-col gap-1.5">
              {associations.dimensions.length > 0 && (
                <AssocGroup label="dimensions" items={associations.dimensions} />
              )}
              {associations.arrays.length > 0 && (
                <AssocGroup label="arrays" items={associations.arrays} />
              )}
              {associations.nested.length > 0 && (
                <AssocGroup
                  label="nested"
                  items={associations.nested.map((n) => `${n.elementName} · ${n.paramName}`)}
                />
              )}
            </div>
          ) : (
            <Empty>no dimension, array, or nested associations</Empty>
          )}
        </Section>

        <ParamMeta param={param} />
      </div>
    </div>
  );
}

function IdentityBadge({
  identity,
  isInstance,
}: {
  identity: ParameterIdentity | null;
  isInstance: boolean;
}) {
  const kind = identity?.kind ?? "NameFallback";
  const label =
    kind === "SharedGuid"
      ? "shared"
      : kind === "BuiltInParameter"
        ? "built-in"
        : kind === "ParameterElement"
          ? "project"
          : "family";
  const title =
    identity?.sharedGuid ??
    (identity?.builtInParameterId != null
      ? `built-in ${identity.builtInParameterId}`
      : identity?.key);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className="rounded-full bg-[color-mix(in_srgb,var(--pe-blue)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--pe-blue)]"
        title={title ?? undefined}
      >
        {label}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
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
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
          className="rounded-full border border-[var(--line-2)] bg-card px-2 py-0.5 text-[11px] hover:border-[var(--pe-blue)] hover:text-[var(--pe-blue)]"
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
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-sm border border-[var(--line-soft)] bg-[var(--paper-2)] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ParamMeta({ param }: { param: FamilyTypesParam }) {
  const bits = [
    param.dataType?.replace(/^autodesk\.spec[.:]/i, "") ?? param.storageType,
    param.isShared ? "shared" : null,
    param.isReadOnly ? "read-only" : null,
  ].filter(Boolean);
  return (
    <div
      className={cn("border-t border-[var(--line-soft)] pt-2 text-[10px] text-muted-foreground")}
    >
      {bits.join(" · ")}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-muted-foreground/60">{children}</div>;
}
