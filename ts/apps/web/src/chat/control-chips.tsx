import { Press } from "#/components/lang/press";
import { ListPopup } from "#/components/lang/list-popup";
import { useWorkbench } from "#/workbench/provider";
import { ACCESS_LEVELS, type AccessLevel } from "#/workbench/chat-state";

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
  /** Refused, and the hint says why (house law 3). */
  disabled?: boolean;
}

/** Model + access pickers: chips that open the one list. */
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
      <ChipList
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
      <ChipList
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

function ChipList({
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
  return (
    <ListPopup<PickerOption>
      anchor="trigger"
      triggerLabel={title}
      title={title}
      trigger={<span className="face-mono truncate">{label}</span>}
      aria-label={title}
      items={options}
      keyOf={(option) => option.id}
      labelOf={(option) => option.name}
      // A short menu never filters; only a searchable one shows its input (R5).
      filter={searchable ? "substring" : "none"}
      searchPlaceholder={`Search ${title.toLowerCase()}…`}
      select="single"
      selected={activeId ? [activeId] : []}
      // Empty is a state: with no session yet, options arrive with the snapshot.
      empty="no session yet"
      onPick={(option) => onPick(option.id)}
      footer={footer}
      row={(option) => ({
        label: option.name,
        sub: option.hint,
        lines: option.hint ? 2 : 1,
        refusal: option.disabled ? "no key" : null,
      })}
    />
  );
}
