import { chatStyles } from "#/components/lang/chat-appearance";
import { Press } from "#/components/lang/press";
import { EmptyState } from "#/components/lang/empty";
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
}

/** Model + access pickers — Combobox-backed chips replacing the hand-rolled Picker. */
export function ControlChips() {
  const { chat, setModel, setAccessLevel } = useWorkbench();
  const { models, access } = chat;
  const modelLabel = models.currentId
    ? (models.available.find((item) => item.id === models.currentId)?.modelName ?? models.currentId)
    : "model";
  const accessLabel = ACCESS_LEVELS.find((item) => item.id === access)?.name ?? access;

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
          hint: item.provider,
        }))}
        onPick={(id) => void setModel(id)}
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
}: {
  title: string;
  label: string;
  activeId?: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  searchable?: boolean;
}) {
  // A picker with no options says where options come from (§4). No dashed edge — dashed is
  // reserved for seam, and "nothing connected yet" is a scope-empty, not a stand-in.
  if (options.length === 0)
    return (
      <EmptyState story="scope" exit="connect the agent — options arrive with the session">
        no {title.toLowerCase()} choices
      </EmptyState>
    );
  const selected = options.find((option) => option.id === activeId) ?? null;
  const anchorRef = useComboboxAnchor();
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option: PickerOption | null) => option && onPick(option.id)}
      itemToStringLabel={(option: PickerOption) => option.name}
    >
      {/* ponytail: explicit anchor on the trigger — the in-popup search input can't be the
          positioner anchor or it feedback-loops (roaming/jittering popup). */}
      <div ref={anchorRef} className={chatStyles.controlChips0()}>
        <ComboboxTrigger title={title} render={<Press tone="quiet" size="value" />}>
          <span className={chatStyles.controlChips1()}>{label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent align="end" anchor={anchorRef}>
        {searchable ? <ComboboxInput placeholder={`Search ${title.toLowerCase()}…`} /> : null}
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => (
            <ComboboxItem key={option.id} value={option}>
              <span className={chatStyles.controlChips2()}>{option.name}</span>
              {option.hint ? (
                <span className={chatStyles.controlChips3()}>{option.hint}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
