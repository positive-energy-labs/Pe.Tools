/**
 * Draft-profile editor — plain controlled forms (no form library) over the co-edited
 * `draftProfile`. Every edit produces a new immutable profile via the model helpers and
 * hands it up through `onChange`; the route decides when to persist it to the shared
 * document. Definitions declare the link rule; assignments bind a definition to a set of
 * source elements (by unique-id).
 */
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { ParameterLinkDefinition, ParameterLinkProfile } from "@pe/agent-contracts";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import {
  REDUCERS,
  RELATIONSHIPS,
  SOURCE_SCOPES,
  addAssignment,
  addDefinition,
  joinUniqueIds,
  parseUniqueIds,
  removeAssignment,
  removeDefinition,
  updateAssignment,
  updateDefinition,
} from "#/parameter-links/model";

export function ProfileEditor({
  profile,
  disabled,
  onChange,
}: {
  profile: ParameterLinkProfile | null;
  disabled?: boolean;
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
  onChange,
}: {
  profile: ParameterLinkProfile;
  definition: ParameterLinkDefinition;
  disabled?: boolean;
  onChange: (next: ParameterLinkProfile) => void;
}) {
  const patch = (fields: Partial<ParameterLinkDefinition>) =>
    onChange(updateDefinition(profile, definition.id, fields));

  const assignments = profile.assignments.filter((asn) => asn.definitionId === definition.id);

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
        <Field label="Source category id">
          <Input
            type="number"
            value={Number.isFinite(definition.sourceCategoryId) ? definition.sourceCategoryId : ""}
            disabled={disabled}
            onChange={(event) =>
              patch({ sourceCategoryId: Math.trunc(Number(event.target.value) || 0) })
            }
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

        <Field label="Source parameter (name)">
          <Input
            value={definition.sourceParameter.name ?? ""}
            placeholder="e.g. Apparent Load"
            disabled={disabled}
            onChange={(event) =>
              patch({
                sourceParameter: { ...definition.sourceParameter, name: event.target.value },
              })
            }
          />
        </Field>
        <Field label="Source parameter (shared GUID)">
          <Input
            value={definition.sourceParameter.sharedGuid ?? ""}
            placeholder="optional"
            disabled={disabled}
            onChange={(event) =>
              patch({
                sourceParameter: {
                  ...definition.sourceParameter,
                  sharedGuid: event.target.value || null,
                },
              })
            }
          />
        </Field>

        <Field label="Target parameter (name)">
          <Input
            value={definition.targetParameter.name ?? ""}
            placeholder="e.g. PE Circuit Load"
            disabled={disabled}
            onChange={(event) =>
              patch({
                targetParameter: { ...definition.targetParameter, name: event.target.value },
              })
            }
          />
        </Field>
        <Field label="Target parameter (shared GUID)">
          <Input
            value={definition.targetParameter.sharedGuid ?? ""}
            placeholder="optional"
            disabled={disabled}
            onChange={(event) =>
              patch({
                targetParameter: {
                  ...definition.targetParameter,
                  sharedGuid: event.target.value || null,
                },
              })
            }
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
            <Field label="Override enabled parameter (name)">
              <Input
                value={definition.targetOverride.enabledParameter.name ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      enabledParameter: {
                        ...definition.targetOverride!.enabledParameter,
                        name: event.target.value,
                      },
                    },
                  })
                }
              />
            </Field>
            <Field label="Override enabled parameter (shared GUID)">
              <Input
                value={definition.targetOverride.enabledParameter.sharedGuid ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      enabledParameter: {
                        ...definition.targetOverride!.enabledParameter,
                        sharedGuid: event.target.value || null,
                      },
                    },
                  })
                }
              />
            </Field>
            <Field label="Override value parameter (name)">
              <Input
                value={definition.targetOverride.valueParameter.name ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      valueParameter: {
                        ...definition.targetOverride!.valueParameter,
                        name: event.target.value,
                      },
                    },
                  })
                }
              />
            </Field>
            <Field label="Override value parameter (shared GUID)">
              <Input
                value={definition.targetOverride.valueParameter.sharedGuid ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  patch({
                    targetOverride: {
                      ...definition.targetOverride!,
                      valueParameter: {
                        ...definition.targetOverride!.valueParameter,
                        sharedGuid: event.target.value || null,
                      },
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
                <Field label="Source element unique-ids (one per line)">
                  <Textarea
                    rows={2}
                    className="min-h-12 font-mono text-[11px]"
                    value={joinUniqueIds(assignment.sourceElementUniqueIds)}
                    placeholder="paste UniqueIds…"
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(
                        updateAssignment(profile, assignment.id, {
                          sourceElementUniqueIds: parseUniqueIds(event.target.value),
                        }),
                      )
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
