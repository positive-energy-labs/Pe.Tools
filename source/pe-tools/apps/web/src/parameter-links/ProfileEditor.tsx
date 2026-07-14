/**
 * Draft-profile editor — plain controlled forms (no form library) over the co-edited
 * `draftProfile`. Every edit produces a new immutable profile via the model helpers and
 * hands it up through `onChange`; the route decides when to persist it to the shared
 * document. Definitions declare the link rule; assignments bind a definition to a set of
 * source elements (by unique-id).
 */
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import type {
  ParameterLinkDefinition,
  ParameterLinkProfile,
  ParameterReference,
} from "@pe/agent-contracts";

import { Button } from "#/components/ui/button";
import {
  FieldOptionMultiSelect,
  FieldOptionSelect,
  type FieldOption,
  parameterReferenceFromOption,
  useFieldOptions,
} from "#/host/field-options";
import {
  REDUCERS,
  RELATIONSHIPS,
  SOURCE_SCOPES,
  addAssignment,
  addDefinition,
  removeAssignment,
  removeDefinition,
  updateAssignment,
  updateDefinition,
} from "#/parameter-links/model";

export function ProfileEditor({
  profile,
  disabled,
  target,
  onChange,
}: {
  profile: ParameterLinkProfile | null;
  disabled?: boolean;
  target?: string;
  onChange: (next: ParameterLinkProfile) => void;
}) {
  if (!profile || profile.definitions.length === 0) {
    return (
      <div className="rounded-[2px] border border-dashed border-[var(--line-2)] px-4 py-8 text-center">
        <p className="text-xs text-[var(--lichen)]">
          No draft profile. Add a definition to start linking parameters.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={disabled}
          onClick={() => onChange(addDefinition(profile))}
        >
          <Plus /> Add definition
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profile.definitions.map((definition) => (
        <DefinitionCard
          key={definition.id}
          profile={profile}
          definition={definition}
          disabled={disabled}
          target={target}
          onChange={onChange}
        />
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange(addDefinition(profile))}
      >
        <Plus /> Add definition
      </Button>
    </div>
  );
}

function DefinitionCard({
  profile,
  definition,
  disabled,
  target,
  onChange,
}: {
  profile: ParameterLinkProfile;
  definition: ParameterLinkDefinition;
  disabled?: boolean;
  target?: string;
  onChange: (next: ParameterLinkProfile) => void;
}) {
  const patch = (fields: Partial<ParameterLinkDefinition>) =>
    onChange(updateDefinition(profile, definition.id, fields));

  const assignments = profile.assignments.filter((asn) => asn.definitionId === definition.id);
  const enabledAssignments = assignments.filter((assignment) => assignment.enabled);
  const hasAllElementsAssignment = enabledAssignments.some(
    (assignment) => assignment.sourceElementUniqueIds.length === 0,
  );
  const sourceElementIds = hasAllElementsAssignment
    ? []
    : Array.from(
        new Set(enabledAssignments.flatMap((assignment) => assignment.sourceElementUniqueIds)),
      );
  const categories = useFieldOptions("category-ids", {}, target);
  const elements = useFieldOptions(
    "element-unique-ids",
    { CategoryId: String(definition.sourceCategoryId) },
    target,
    definition.sourceCategoryId !== 0,
  );
  const sourceParameters = useFieldOptions(
    "parameter-identities",
    {
      CategoryId: String(definition.sourceCategoryId),
      ParameterScope: "instanceThenType",
      ...(sourceElementIds.length ? { ElementUniqueIds: sourceElementIds.join("\n") } : {}),
    },
    target,
    definition.sourceCategoryId !== 0,
  );
  const targetCategoryId =
    definition.relationship === "sameElement"
      ? definition.sourceCategoryId
      : Number(
          categories.items.find(
            (item) => item.metadata?.builtInCategory === "OST_ElectricalCircuit",
          )?.value ?? 0,
        );
  const selectedSource = findParameterOption(sourceParameters.items, definition.sourceParameter);
  const targetParameters = useFieldOptions(
    "parameter-identities",
    {
      CategoryId: String(targetCategoryId),
      ParameterScope: "instance",
      WritableOnly: "true",
      ...(selectedSource?.metadata?.storageType
        ? { StorageType: selectedSource.metadata.storageType }
        : {}),
      ...(selectedSource?.metadata?.dataTypeId
        ? { DataTypeId: selectedSource.metadata.dataTypeId }
        : {}),
    },
    target,
    targetCategoryId !== 0,
  );
  const readableTargetParameters = useFieldOptions(
    "parameter-identities",
    { CategoryId: String(targetCategoryId), ParameterScope: "instance" },
    target,
    targetCategoryId !== 0,
  );

  return (
    <div className="rounded-[2px] border border-[var(--line-2)] bg-[var(--paper)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] px-3 py-1.5">
        <input
          value={definition.id}
          disabled={disabled}
          onChange={(event) => patch({ id: event.target.value })}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--clay-ink)] outline-none"
          aria-label="definition id"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          title="Remove definition"
          disabled={disabled}
          onClick={() => onChange(removeDefinition(profile, definition.id))}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="grid gap-2 px-3 py-2.5 sm:grid-cols-2">
        <Field label="Source category">
          <FieldOptionSelect
            items={categories.items}
            value={definition.sourceCategoryId ? String(definition.sourceCategoryId) : undefined}
            fallbackLabel={
              definition.sourceCategoryId ? `Category ${definition.sourceCategoryId}` : undefined
            }
            placeholder={categories.isPending ? "Loading categories…" : "Choose a category"}
            disabled={disabled}
            onChange={(option) => patch({ sourceCategoryId: Number(option.value) })}
          />
        </Field>
        <Field label="Relationship">
          <Enum
            value={definition.relationship}
            options={RELATIONSHIPS}
            disabled={disabled}
            onChange={(relationship) => patch({ relationship })}
          />
        </Field>

        <Field label="Source parameter">
          <FieldOptionSelect
            items={sourceParameters.items}
            value={
              selectedSource?.value ??
              parameterOptionValue(definition.sourceParameter, definition.sourceScope)
            }
            fallbackLabel={parameterLabel(definition.sourceParameter)}
            placeholder={
              sourceParameters.isPending ? "Loading parameters…" : "Choose a source parameter"
            }
            disabled={disabled || definition.sourceCategoryId === 0}
            onChange={(option) =>
              patch({
                sourceParameter: parameterReferenceFromOption(option),
              })
            }
          />
        </Field>
        <Field label="Target parameter">
          <FieldOptionSelect
            items={targetParameters.items}
            value={
              findParameterOption(targetParameters.items, definition.targetParameter)?.value ??
              parameterOptionValue(definition.targetParameter, "instance")
            }
            fallbackLabel={parameterLabel(definition.targetParameter)}
            placeholder={
              targetParameters.isPending
                ? "Loading compatible parameters…"
                : "Choose a target parameter"
            }
            disabled={disabled || targetCategoryId === 0}
            onChange={(option) => patch({ targetParameter: parameterReferenceFromOption(option) })}
          />
        </Field>

        <Field label="Source scope">
          <Enum
            value={definition.sourceScope}
            options={SOURCE_SCOPES}
            disabled={disabled}
            onChange={(sourceScope) => patch({ sourceScope })}
          />
        </Field>
        <Field label="Reducer">
          <Enum
            value={definition.reducer}
            options={REDUCERS}
            disabled={disabled}
            onChange={(reducer) => patch({ reducer })}
          />
        </Field>
        <label className="flex items-center gap-1.5 text-xs text-[var(--slate)] sm:col-span-2">
          <input
            type="checkbox"
            checked={definition.targetOverride != null}
            disabled={disabled}
            onChange={(event) =>
              patch({
                targetOverride: event.target.checked
                  ? { enabledParameter: { name: "" }, valueParameter: { name: "" } }
                  : null,
              })
            }
          />
          Allow a target-side override
        </label>
        {definition.targetOverride ? (
          <>
            <Field label="Override enabled parameter">
              <FieldOptionSelect
                items={readableTargetParameters.items.filter((item) =>
                  item.metadata?.dataTypeId?.includes("yesno"),
                )}
                value={
                  findParameterOption(
                    readableTargetParameters.items,
                    definition.targetOverride.enabledParameter,
                  )?.value
                }
                fallbackLabel={parameterLabel(definition.targetOverride.enabledParameter)}
                placeholder="Choose a Yes/No parameter"
                disabled={disabled}
                onChange={(option) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      enabledParameter: parameterReferenceFromOption(option),
                    },
                  })
                }
              />
            </Field>
            <Field label="Override value parameter">
              <FieldOptionSelect
                items={readableTargetParameters.items.filter(
                  (item) =>
                    !selectedSource?.metadata?.dataTypeId ||
                    item.metadata?.dataTypeId === selectedSource.metadata.dataTypeId,
                )}
                value={
                  findParameterOption(
                    readableTargetParameters.items,
                    definition.targetOverride.valueParameter,
                  )?.value
                }
                fallbackLabel={parameterLabel(definition.targetOverride.valueParameter)}
                placeholder="Choose an override value parameter"
                disabled={disabled}
                onChange={(option) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      valueParameter: parameterReferenceFromOption(option),
                    },
                  })
                }
              />
            </Field>
          </>
        ) : null}
      </div>

      <div className="border-t border-[var(--line-2)] px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="tele-label text-[var(--lichen)]">Assignments</span>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(addAssignment(profile, definition.id))}
          >
            <Plus /> Add assignment
          </Button>
        </div>
        {assignments.length === 0 ? (
          <p className="py-1 text-[10px] text-[var(--lichen)]">
            No assignments — this definition links nothing until you bind source elements.
          </p>
        ) : (
          <div className="space-y-2">
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="rounded-[2px] border border-[var(--line-2)] px-2 py-1.5"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--slate)]">
                    <input
                      type="checkbox"
                      checked={assignment.enabled}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange(
                          updateAssignment(profile, assignment.id, {
                            enabled: event.target.checked,
                          }),
                        )
                      }
                    />
                    enabled
                  </label>
                  <span className="truncate font-mono text-[10px] text-[var(--lichen)]">
                    {assignment.id}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="Remove assignment"
                    disabled={disabled}
                    onClick={() => onChange(removeAssignment(profile, assignment.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Field label="Source elements">
                  <FieldOptionMultiSelect
                    items={elements.items}
                    values={assignment.sourceElementUniqueIds}
                    disabled={disabled}
                    onChange={(sourceElementUniqueIds) =>
                      onChange(updateAssignment(profile, assignment.id, { sourceElementUniqueIds }))
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findParameterOption(items: FieldOption[], reference: ParameterReference) {
  return items.find(
    (item) =>
      (reference.identity?.key && item.metadata?.key === reference.identity.key) ||
      (reference.sharedGuid && item.metadata?.sharedGuid === reference.sharedGuid) ||
      (reference.name && item.metadata?.name.toLowerCase() === reference.name.toLowerCase()),
  );
}

function parameterOptionValue(reference: ParameterReference, scope: string) {
  if (reference.identity?.key)
    return `${reference.identity.key}|${scope === "type" ? "type" : "instance"}`;
  return reference.sharedGuid
    ? `shared:${reference.sharedGuid}|${scope}`
    : reference.name
      ? `name:${reference.name}|${scope}`
      : undefined;
}

function parameterLabel(reference: ParameterReference) {
  return reference.identity?.name ?? reference.name ?? reference.sharedGuid ?? undefined;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="tele-label text-[var(--lichen)]">{label}</span>
      {children}
    </label>
  );
}

function Enum<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly T[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-7 w-full rounded-md border border-input bg-input/20 px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 dark:bg-input/30"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
