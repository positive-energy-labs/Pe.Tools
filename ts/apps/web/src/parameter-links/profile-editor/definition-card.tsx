import { Plus, Trash2 } from "lucide-react";
import type {
  DocumentRef,
  ParameterLinkDefinition,
  ParameterLinkProfile,
} from "@pe/agent-contracts";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { EmptyState } from "#/components/lang/empty";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import {
  FieldOptionPicker,
  FieldOptionSelect,
  parameterReferenceFromOption,
  pickerOptions,
} from "#/host/field-options";
import { useFieldOptionsReading } from "#/readings";
import {
  REDUCERS,
  RELATIONSHIPS,
  SOURCE_SCOPES,
  addAssignment,
  removeAssignment,
  removeDefinition,
  updateAssignment,
  updateDefinition,
} from "#/parameter-links/model";
import { Enum, Field, findParameterOption, parameterLabel, parameterOptionValue } from "./field";

export function DefinitionCard({
  profile,
  definition,
  disabled,
  fieldOptionsEnabled = true,
  target,
  onChange,
}: {
  profile: ParameterLinkProfile;
  definition: ParameterLinkDefinition;
  disabled?: boolean;
  fieldOptionsEnabled?: boolean;
  target?: DocumentRef | null;
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
  const categories = pickerOptions(
    useFieldOptionsReading(fieldOptionsEnabled ? target : null, "category-ids"),
  );
  const elements = pickerOptions(
    useFieldOptionsReading(
      fieldOptionsEnabled && definition.sourceCategoryId !== 0 ? target : null,
      "element-unique-ids",
      { CategoryId: String(definition.sourceCategoryId) },
    ),
  );
  const sourceParameters = pickerOptions(
    useFieldOptionsReading(
      fieldOptionsEnabled && definition.sourceCategoryId !== 0 ? target : null,
      "parameter-identities",
      {
        CategoryId: String(definition.sourceCategoryId),
        ParameterScope: "instanceThenType",
        ...(sourceElementIds.length ? { ElementUniqueIds: sourceElementIds.join("\n") } : {}),
      },
    ),
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
  const targetParameters = pickerOptions(
    useFieldOptionsReading(
      fieldOptionsEnabled && targetCategoryId !== 0 ? target : null,
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
    ),
  );
  const readableTargetParameters = pickerOptions(
    useFieldOptionsReading(
      fieldOptionsEnabled && targetCategoryId !== 0 ? target : null,
      "parameter-identities",
      { CategoryId: String(targetCategoryId), ParameterScope: "instance" },
    ),
  );

  return (
    <ArtifactFrame
      head={
        <>
          <Input
            value={definition.id}
            disabled={disabled}
            onChange={(event) => patch({ id: event.target.value })}
            aria-label="definition id"
            title="The definition's id — how assignments and receipts refer to it"
          />
          <ActionButton
            label="remove"
            icon={Trash2}
            disabled={disabled}
            onClick={() => onChange(removeDefinition(profile, definition.id))}
            reason="Remove this definition and its assignments from the draft (local until saved)"
          />
        </>
      }
    >
      <div className="grid gap-2 px-3 py-2.5 sm:grid-cols-2">
        <Field label="Source category">
          <FieldOptionSelect
            items={categories.items}
            status={categories.status}
            value={definition.sourceCategoryId ? String(definition.sourceCategoryId) : undefined}
            fallbackLabel={
              definition.sourceCategoryId ? `Category ${definition.sourceCategoryId}` : undefined
            }
            placeholder={
              categories.status === "pending" ? "Loading categories…" : "Choose a category"
            }
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
            status={sourceParameters.status}
            value={
              selectedSource?.value ??
              parameterOptionValue(definition.sourceParameter, definition.sourceScope)
            }
            fallbackLabel={parameterLabel(definition.sourceParameter)}
            placeholder={
              sourceParameters.status === "pending"
                ? "Loading parameters…"
                : "Choose a source parameter"
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
            status={targetParameters.status}
            value={
              findParameterOption(targetParameters.items, definition.targetParameter)?.value ??
              parameterOptionValue(definition.targetParameter, "instance")
            }
            fallbackLabel={parameterLabel(definition.targetParameter)}
            placeholder={
              targetParameters.status === "pending"
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
        <label className="flex items-center gap-1.5 sm:col-span-2">
          <Input
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
                status={readableTargetParameters.status}
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
                status={readableTargetParameters.status}
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

      <div className="px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="">Assignments</span>
          <ActionButton
            label="add assignment"
            icon={Plus}
            disabled={disabled}
            onClick={() => onChange(addAssignment(profile, definition.id))}
            reason="Bind this definition to a set of source elements (empty set = every element in the category)"
          />
        </div>
        {assignments.length === 0 ? (
          <EmptyState story="scope" exit="add an assignment and bind source elements">
            no assignments — this definition links nothing
          </EmptyState>
        ) : (
          <div>
            {assignments.map((assignment) => (
              <div key={assignment.id} className="py-1.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5">
                    <Input
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
                  <span className="truncate">{assignment.id}</span>
                  <ActionButton
                    label="remove"
                    icon={Trash2}
                    disabled={disabled}
                    onClick={() => onChange(removeAssignment(profile, assignment.id))}
                    reason="Remove this assignment from the draft (local until saved)"
                  />
                </div>
                <Field label="Source elements">
                  <FieldOptionPicker
                    items={elements.items}
                    status={elements.status}
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
    </ArtifactFrame>
  );
}
