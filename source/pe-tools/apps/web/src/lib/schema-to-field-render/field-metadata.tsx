import { CircleHelp } from "lucide-react";
import { Label } from "#/components/mechanism/label";
import { Tooltip, UiTooltipProvider } from "#/components/mechanism/tooltip";
import { cn } from "#/lib/utils";
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

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value as string);
  }
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
        <Tooltip.Trigger
          aria-label="Field details"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-2"
        >
          <CircleHelp className="h-4 w-4" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup className="z-modal max-w-sm rounded-md border border-line bg-page px-3 py-2 text-xs">
              <div className="space-y-2">
                {description ? (
                  <div className="space-y-1">
                    <div className="font-medium text-ink">Description</div>
                    <p className="whitespace-pre-wrap text-ink-2">{description}</p>
                  </div>
                ) : null}
                {formattedDefault !== undefined ? (
                  <div className="space-y-1">
                    <div className="font-medium text-ink">Default</div>
                    <pre className="t-label whitespace-pre-wrap break-words rounded-[2px] bg-recess px-2 py-1 face-mono text-ink">
                      {formattedDefault}
                    </pre>
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

export function FieldChangeBadge({ path, compact = false }: { path?: string; compact?: boolean }) {
  const change = useFieldChangeSummary(path ?? "");
  if (!path || !change) {
    return null;
  }

  const beforeSummary = summarizeValue(change.beforeValue);
  const afterSummary = summarizeValue(change.afterValue);
  const beforeValue = formatValue(change.beforeValue);
  const afterValue = formatValue(change.afterValue);
  const beforeDisplay = change.isComposite
    ? beforeSummary
    : (beforeValue ?? beforeSummary ?? "undefined");
  const afterDisplay = change.isComposite
    ? afterSummary
    : (afterValue ?? afterSummary ?? "undefined");
  const nestedChanges = change.isComposite ? Math.max(1, change.descendantChanges) : 0;
  const label =
    change.isComposite && nestedChanges > 0
      ? `${nestedChanges} change${nestedChanges === 1 ? "" : "s"}`
      : "Changed";

  return (
    <UiTooltipProvider>
      <Tooltip.Root>
        <Tooltip.Trigger
          aria-label="View change details"
          className={cn(
            "t-caption t-upper inline-flex items-center rounded-[2px] border px-1.5 py-0.5 font-semibold",
            "border-caution/30 bg-caution/10 text-caution",
            // Compact buys tighter padding only — the tier already IS the small size.
            compact && "px-1 py-0",
          )}
        >
          {label}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup className="z-modal max-w-sm rounded-md border border-line bg-page px-3 py-2 text-xs">
              <div className="space-y-2">
                {change.isComposite && nestedChanges > 0 ? (
                  <p className="text-ink-2">
                    {nestedChanges} nested field
                    {nestedChanges === 1 ? "" : "s"} changed.
                  </p>
                ) : null}
                <div className="space-y-1">
                  <div className="font-medium text-ink">Before</div>
                  <pre className="t-label whitespace-pre-wrap break-words rounded-[2px] bg-recess px-2 py-1 face-mono text-ink">
                    {beforeDisplay}
                  </pre>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-ink">After</div>
                  <pre className="t-label whitespace-pre-wrap break-words rounded-[2px] bg-recess px-2 py-1 face-mono text-ink">
                    {afterDisplay}
                  </pre>
                </div>
              </div>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </UiTooltipProvider>
  );
}

export function FieldMessages({
  messages,
  compact = false,
}: {
  messages: string[];
  compact?: boolean;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-[2px] border px-3 py-2 text-xs",
        "border-alarm/30 bg-alarm/10 text-alarm",
        compact && "t-label px-2 py-1.5",
      )}
    >
      <ul className="space-y-1">
        {messages.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function OptionMetadataChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "t-caption inline-flex max-w-full items-center truncate rounded-[2px] border px-1.5 py-0.5 font-medium",
        tone === "neutral" && "border-line bg-recess/40 text-ink-mute",
        tone === "warning" && "border-caution/30 bg-caution/10 text-caution",
        tone === "danger" && "border-alarm/30 bg-alarm/10 text-alarm",
      )}
    >
      {children}
    </span>
  );
}

export function FieldOptionsMetadata({ options }: { options: FieldOptionState }) {
  if (
    options.source === "none" &&
    options.dependencies.length === 0 &&
    !options.errorMessage &&
    !options.isLoading
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <OptionMetadataChip tone={options.isLoading ? "warning" : "neutral"}>
        {options.sourceKey ? `source ${options.sourceKey}` : options.source}
      </OptionMetadataChip>
      {options.isLoading ? <OptionMetadataChip tone="warning">loading</OptionMetadataChip> : null}
      {options.resolver ? (
        <OptionMetadataChip>{`resolver ${options.resolver}`}</OptionMetadataChip>
      ) : null}
      {options.dataset ? (
        <OptionMetadataChip>{`dataset ${options.dataset}`}</OptionMetadataChip>
      ) : null}
      <OptionMetadataChip>
        {options.allowsCustomValue ? "custom allowed" : "fixed choices"}
      </OptionMetadataChip>
      <OptionMetadataChip>{`mode ${options.mode}`}</OptionMetadataChip>
      {options.dependencies.map((dependency) => (
        <OptionMetadataChip key={`${dependency.scope ?? "context"}:${dependency.key}`}>
          {`${dependency.key}=${dependency.value ?? "unset"}`}
        </OptionMetadataChip>
      ))}
      {options.errorMessage ? (
        <OptionMetadataChip tone="danger">{options.errorMessage}</OptionMetadataChip>
      ) : null}
    </div>
  );
}

function RequiredBadge() {
  return (
    <span
      aria-label="Required"
      className="t-caption t-upper inline-flex items-center rounded-[2px] bg-alarm/10 px-1.5 py-0.5 font-semibold text-alarm"
    >
      Required
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
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className="font-medium">
        {label}
      </Label>
      {required ? <RequiredBadge /> : null}
      <FieldChangeBadge path={path} />
      <FieldMetadataTooltip description={description} defaultValue={defaultValue} />
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
    <div className="inline-flex items-center gap-2 px-2 text-sm text-ink-2">
      <span>{label}</span>
      {required ? <RequiredBadge /> : null}
      <FieldChangeBadge path={path} />
      <FieldMetadataTooltip description={description} defaultValue={defaultValue} />
    </div>
  );
}
