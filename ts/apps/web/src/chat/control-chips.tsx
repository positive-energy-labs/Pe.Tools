import { ListPopup } from "#/components/lang/list-popup";
import { useWorkbench } from "#/workbench/provider";

interface PickerOption {
  id: string;
  name: string;
  /** Said in caution under the name: what picking it gives up. */
  caution?: string;
}

/** Modes that run every tool without asking (claude `bypassPermissions`, codex `full-access`). */
const UNGUARDED = /bypass|full-access|never/i;

/** The harness's modes, unguarded ones tagged and last; the web never picks one on its own. */
const modeOptions = (modes: { id: string; name: string }[]): PickerOption[] =>
  modes
    .map(
      (mode): PickerOption =>
        UNGUARDED.test(mode.id) ? { ...mode, caution: "no approval cards" } : mode,
    )
    .sort((left, right) => Number(Boolean(left.caution)) - Number(Boolean(right.caution)));

/** The harness's model and mode pickers; either hides when the harness offers no list. */
export function ControlChips() {
  const { chat, setModel, setMode } = useWorkbench();
  const { models, modelId, modes, modeId } = chat;
  return (
    <>
      {models.length > 0 ? (
        <ChipList
          title="Model"
          label={models.find((item) => item.modelId === modelId)?.name ?? modelId ?? "model"}
          activeId={modelId ?? undefined}
          searchable
          options={models.map((item) => ({ id: item.modelId, name: item.name }))}
          onPick={(id) => void setModel(id)}
        />
      ) : null}
      {modes.length > 0 ? (
        <ChipList
          title="Mode"
          label={modes.find((item) => item.id === modeId)?.name ?? modeId ?? "mode"}
          activeId={modeId ?? undefined}
          options={modeOptions(modes)}
          onPick={(id) => void setMode(id)}
        />
      ) : null}
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
}: {
  title: string;
  label: string;
  activeId?: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  searchable?: boolean;
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
      empty="none offered"
      onPick={(option) => onPick(option.id)}
      row={(option) => ({
        label: option.name,
        sub: option.caution ? <span data-tone="caution">{option.caution}</span> : undefined,
      })}
    />
  );
}
