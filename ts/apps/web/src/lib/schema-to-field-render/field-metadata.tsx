import { CircleHelp } from "lucide-react";
import { FactChip, Tag } from "#/components/lang/chip";
import { Code, stringify } from "#/components/lang/code";
import { Label } from "#/components/lang/label";
import { OutcomeLine } from "#/components/lang/outcome";
import { Tooltip, UiTooltipProvider } from "#/components/lang/tooltip";
import type { MemberIssue } from "@pe/host-contracts/operation-types";
import { type FieldOptionState, useFieldChangeSummary } from "./shared";

function formatValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value.length > 0 ? value : '""';
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return stringify(value);
}

function summarizeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value.length > 0 ? value : '""';
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `${keys.length} field${keys.length === 1 ? "" : "s"}`;
  }

  return String(value as string);
}

function FieldMetadataTooltip({
  description,
  defaultValue,
}: {
  description?: string;
  defaultValue?: unknown;
}) {
  const formattedDefault = formatValue(defaultValue);
  if (!description && formattedDefault === undefined) {
    return null;
  }

  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger aria-label="Field details" kind="icon">
          <CircleHelp className="h-4 w-4" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup>
              <div className="space-y-2">
                {description ? (
                  <div className="space-y-1">
                    <div className="t-small t-upper text-ink">Description</div>
                    <p className="whitespace-pre-wrap t-small text-ink-2">{description}</p>
                  </div>
                ) : null}
                {formattedDefault !== undefined ? (
                  <div className="space-y-1">
                    <Code code={formattedDefault} lang="json" title="Default" clamp={false} />
                  </div>
                ) : null}
              </div>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}

function FieldChangeBadge({ path, compact = false }: { path?: string; compact?: boolean }) {
  const change = useFieldChangeSummary(path ?? "");
  if (!path || !change) {
    return null;
  }

  const beforeSummary = summarizeValue(change.beforeValue);
  const afterSummary = summarizeValue(change.afterValue);
  const beforeValue = formatValue(change.beforeValue);
  const afterValue = formatValue(change.afterValue);
  const beforeDisplay =
    (change.isComposite ? beforeSummary : (beforeValue ?? beforeSummary)) ?? "undefined";
  const afterDisplay =
    (change.isComposite ? afterSummary : (afterValue ?? afterSummary)) ?? "undefined";
  const nestedChanges = change.isComposite ? Math.max(1, change.descendantChanges) : 0;
  const label =
    change.isComposite && nestedChanges > 0
      ? `${nestedChanges} change${nestedChanges === 1 ? "" : "s"}`
      : "Changed";

  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger aria-label="View change details" size={compact ? "compact" : "default"}>
          <FactChip tone="caution" title="Open the saved and staged values.">
            {label}
          </FactChip>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup>
              <div className="space-y-2">
                {change.isComposite && nestedChanges > 0 ? (
                  <p className="t-small text-ink-2">
                    {nestedChanges} nested field
                    {nestedChanges === 1 ? "" : "s"} changed.
                  </p>
                ) : null}
                <div className="space-y-1">
                  <Code code={beforeDisplay} lang="json" title="Before" clamp={false} />
                </div>
                <div className="space-y-1">
                  <Code code={afterDisplay} lang="json" title="After" clamp={false} />
                </div>
              </div>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}

/** The host's reasons on this field, in the outcome-line house style: code, then the sentence. */
export function FieldMessages({
  messages,
  compact = false,
}: {
  messages: readonly MemberIssue[];
  compact?: boolean;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <ul className={compact ? "space-y-0.5 py-1" : "space-y-1 py-1.5"}>
      {messages.map((issue, index) => (
        <li key={`${issue.message}-${index}`}>
          <OutcomeLine
            kind={issue.severity === "error" ? "error" : "advisory"}
            label={issue.code}
            says={issue.message}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * What a field's options are: the value domain, how it binds, where its values come from (baked
 * HostOnly or read from the live document), how many and which, and whether Revit changed the
 * document after they were read.
 */
export function FieldOptions({ options }: { options: FieldOptionState }) {
  if (
    options.source === "none" &&
    options.dependencies.length === 0 &&
    !options.errorMessage &&
    !options.isLoading
  ) {
    return null;
  }
  const shown = options.items.slice(0, 3).map((item) => item.label);
  const more = options.items.length > shown.length ? ", …" : "";

  return (
    <div className="flex flex-wrap gap-1">
      <FactChip title="The value domain that supplies this field's choices.">
        {options.sourceKey ?? options.source}
      </FactChip>
      <FactChip title="Whether the choices constrain the value or only suggest it.">
        {options.allowsCustomValue ? options.mode : `${options.mode}, fixed`}
      </FactChip>
      {options.runtime ? (
        <FactChip title="HostOnly values are baked into the schema; LiveDocument values are read from the open document.">
          {options.runtime === "HostOnly" ? "baked" : "live document"}
        </FactChip>
      ) : null}
      <FactChip title="How many choices the field offers, and the first few.">
        {options.isLoading
          ? "loading"
          : `${options.items.length} options${shown.length ? ` · ${shown.join(", ")}${more}` : ""}`}
      </FactChip>
      {options.changed ? (
        <FactChip tone="caution" title="Revit changed this document after these options were read.">
          changed in Revit
        </FactChip>
      ) : null}
      {options.dependencies.map((dependency) => (
        <FactChip
          key={`${dependency.scope ?? "context"}:${dependency.key}`}
          title="The dependency value used to resolve this field's choices."
        >
          {`${dependency.key}=${dependency.value ?? "unset"}`}
        </FactChip>
      ))}
      {options.errorMessage ? (
        <FactChip title={`Option resolution failed: ${options.errorMessage}`} tone="caution">
          {options.errorMessage}
        </FactChip>
      ) : null}
    </div>
  );
}

function RequiredBadge() {
  return (
    <span aria-label="Required">
      <Tag>required</Tag>
    </span>
  );
}

export function FieldLabelRow({
  label,
  htmlFor,
  required,
  description,
  defaultValue,
  path,
}: {
  label: string;
  htmlFor?: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  path?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Label htmlFor={htmlFor}>
        <span className="t-small t-upper face-mono text-ink-2">{label}</span>
      </Label>
      {required ? <RequiredBadge /> : null}
      <FieldMetadataTooltip description={description} defaultValue={defaultValue} />
      <span className="ml-auto">
        <FieldChangeBadge path={path} />
      </span>
    </div>
  );
}

export function FieldLegendRow({
  label,
  required,
  description,
  defaultValue,
  path,
}: {
  label: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  path?: string;
}) {
  return (
    <div className="hairline-b t-small t-upper flex w-full items-center gap-1 pb-1 text-ink-2">
      <span>{label}</span>
      {required ? <RequiredBadge /> : null}
      <FieldMetadataTooltip description={description} defaultValue={defaultValue} />
      <span className="ml-auto">
        <FieldChangeBadge path={path} />
      </span>
    </div>
  );
}
