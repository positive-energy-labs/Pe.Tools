import { Button } from "#/components/ui/button";
import { ChatTargetChip } from "#/components/chat-target";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/ui/combobox";
import { useWorkbench } from "#/workbench/provider";
import type { WorkbenchAccessLevel } from "@pe/agent-contracts";

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
}

/** Model + access pickers — shadcn DropdownMenu radio groups replacing the hand-rolled Picker. */
export function ControlChips() {
  const { debug, setModel, setAccessLevel } = useWorkbench();
  const { models, access } = debug.state;
  const modelLabel = models.currentModelId
    ? (models.availableModels.find((item) => item.id === models.currentModelId)?.displayName ??
      models.currentModelId)
    : "model";
  const accessLabel =
    access.availableAccessLevels.find((item) => item.id === access.currentAccessLevel)?.name ??
    access.currentAccessLevel ??
    "access";

  return (
    <>
      <Picker
        title="Model"
        label={modelLabel}
        activeId={models.currentModelId}
        searchable
        options={models.availableModels.map((item) => ({
          id: item.id,
          name: item.displayName ?? item.id,
          hint: item.provider,
        }))}
        onPick={(id) => void setModel(id)}
      />
      <Picker
        title="Access"
        label={accessLabel}
        activeId={access.currentAccessLevel}
        options={access.availableAccessLevels.map((item) => ({
          id: item.id,
          name: item.name,
          hint: item.description,
        }))}
        onPick={(id) => void setAccessLevel(id as WorkbenchAccessLevel)}
      />
      <ChatTargetChip />
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
  if (options.length === 0)
    return (
      <span className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
        {label}
      </span>
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
      <div ref={anchorRef} className="inline-flex">
        <ComboboxTrigger
          title={title}
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-40 justify-between gap-1 px-2 text-muted-foreground"
            />
          }
        >
          <span className="tele truncate">{label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent align="end" anchor={anchorRef} className="min-w-56">
        {searchable ? <ComboboxInput placeholder={`Search ${title.toLowerCase()}…`} /> : null}
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => (
            <ComboboxItem key={option.id} value={option} className="flex-col items-start pr-7">
              <span className="text-foreground">{option.name}</span>
              {option.hint ? (
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
