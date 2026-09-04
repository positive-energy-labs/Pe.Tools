import { Press } from "#/components/lang/press";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/lang/combobox";
import { useWorkbench } from "#/workbench/provider";
import { ACCESS_LEVELS, type AccessLevel } from "#/workbench/chat-state";

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
  /** Refused, and the hint says why (house law 3). */
  disabled?: boolean;
}

/** Model + access pickers — Combobox-backed chips. */
export function ControlChips() {
  const { chat, setModel, setAccessLevel, addApiKey } = useWorkbench();
  const { models, access } = chat;
  const modelLabel = models.currentId
    ? (models.available.find((item) => item.id === models.currentId)?.modelName ?? models.currentId)
    : "model";
  const accessLabel = ACCESS_LEVELS.find((item) => item.id === access)?.name ?? access;
  // Providers on the list with nothing to sign with: each gets one exit, "add key".
  const keyless = [
    ...new Set(models.available.filter((item) => !item.hasApiKey).map((item) => item.provider)),
  ];
  // ponytail: window.prompt is the paste surface; a kit field replaces it when a second key flow exists.
  const pasteKey = (provider: string) => {
    const apiKey = window.prompt(`${provider} API key`)?.trim();
    if (apiKey) void addApiKey(provider, apiKey);
  };

  return (
    <>
      <Picker
        title="Model"
        label={modelLabel}
        activeId={models.currentId}
        searchable
        options={models.available.map((item) => ({
          id: item.id,
          name: item.modelName ?? item.id,
          hint: item.hasApiKey ? item.provider : `${item.provider} — no key`,
          disabled: !item.hasApiKey,
        }))}
        onPick={(id) => void setModel(id)}
        footer={keyless.map((provider) => (
          <Press key={provider} tone="quiet" size="value" onClick={() => pasteKey(provider)}>
            add {provider} key
          </Press>
        ))}
      />
      <Picker
        title="Access"
        label={accessLabel}
        activeId={access}
        options={ACCESS_LEVELS.map((item) => ({
          id: item.id,
          name: item.name,
          hint: item.description,
        }))}
        onPick={(id) => void setAccessLevel(id as AccessLevel)}
      />
    </>
  );
}

function Picker({
  title,
  label,
  activeId,
  options,
  onPick,
  searchable = false,
  footer,
}: {
  title: string;
  label: string;
  activeId?: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  searchable?: boolean;
  footer?: React.ReactNode;
}) {
  const selected = options.find((option) => option.id === activeId) ?? null;
  const anchorRef = useComboboxAnchor();
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option: PickerOption | null) => option && onPick(option.id)}
      itemToStringLabel={(option: PickerOption) => option.name}
      // A picker without a search input must never filter: Base UI otherwise narrows the list
      // to the stale label query (a Read-only chip opened to only "Ask", 2026-09-03 scenario).
      filter={searchable ? undefined : null}
    >
      {/* ponytail: explicit anchor on the trigger — the in-popup search input can't be the
          positioner anchor or it feedback-loops (roaming/jittering popup). */}
      <div ref={anchorRef} className="inline-flex">
        <ComboboxTrigger
          aria-label={title}
          title={title}
          render={<Press tone="quiet" size="value" />}
        >
          <span className="face-mono truncate">{label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef}>
        {searchable ? <ComboboxInput placeholder={`Search ${title.toLowerCase()}…`} /> : null}
        {/* Empty is a state: with no session yet, options arrive with the snapshot. */}
        <ComboboxEmpty>{options.length === 0 ? "no session yet" : "No matches"}</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => (
            <ComboboxItem key={option.id} value={option} disabled={option.disabled}>
              <span className="flex min-w-0 flex-col">
                <span className="text-ink">{option.name}</span>
                {option.hint ? <span className="text-ink-2">{option.hint}</span> : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {footer}
      </ComboboxContent>
    </Combobox>
  );
}
