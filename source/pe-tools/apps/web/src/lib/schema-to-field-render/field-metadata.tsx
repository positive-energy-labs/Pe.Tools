import { CircleHelp } from "lucide-react";
import { Label } from "#/components/ui/label";
import { Tooltip, UiTooltipProvider } from "#/components/ui/tooltip";
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
          className="inline-flex h-5 w-5 items-center justify-center"
        >
          <CircleHelp className="h-4 w-4" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup className="z-popup max-w-sm px-3 py-2">
              <div className="space-y-2">
                {description ? (
                  <div className="space-y-1">
                    <div className="">Description</div>
                    <p className="whitespace-pre-wrap">{description}</p>
                  </div>
                ) : null}
                {formattedDefault !== undefined ? (
                  <div className="space-y-1">
                    <div className="">Default</div>
                    <pre className="whitespace-pre-wrap break-words px-2 py-1">
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
            "inline-flex items-center px-1.5 py-0.5",
            "",
            // Compact buys tighter padding only — the tier already IS the small size.
            compact && "px-1 py-0",
          )}
        >
          {label}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={8}>
            <Tooltip.Popup className="z-popup max-w-sm px-3 py-2">
              <div className="space-y-2">
                {change.isComposite && nestedChanges > 0 ? (
                  <p className="">
                    {nestedChanges} nested field
                    {nestedChanges === 1 ? "" : "s"} changed.
                  </p>
                ) : null}
                <div className="space-y-1">
                  <div className="">Before</div>
                  <pre className="whitespace-pre-wrap break-words px-2 py-1">{beforeDisplay}</pre>
                </div>
                <div className="space-y-1">
                  <div className="">After</div>
                  <pre className="whitespace-pre-wrap break-words px-2 py-1">{afterDisplay}</pre>
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
    <div className={cn("px-3 py-2", "", compact && "px-2 py-1.5")}>
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
        "inline-flex max-w-full items-center truncate px-1.5 py-0.5",
        tone === "neutral" && "",
        tone === "warning" && "",
        tone === "danger" && "",
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
    <span aria-label="Required" className="inline-flex items-center px-1.5 py-0.5">
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
      <Label htmlFor={htmlFor} className="">
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
    <div className="inline-flex items-center gap-2 px-2">
      <span>{label}</span>
      {required ? <RequiredBadge /> : null}
      <FieldChangeBadge path={path} />
      <FieldMetadataTooltip description={description} defaultValue={defaultValue} />
    </div>
  );
}
