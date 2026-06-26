import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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
    </>
  );
}

function Picker({
  title,
  label,
  activeId,
  options,
  onPick,
}: {
  title: string;
  label: string;
  activeId?: string;
  options: PickerOption[];
  onPick: (id: string) => void;
}) {
  if (options.length === 0)
    return (
      <span className="rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
        {label}
      </span>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={title}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {label}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80 min-w-52">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeId ?? ""} onValueChange={onPick}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              className="flex-col items-start"
            >
              <span className="text-foreground">{option.name}</span>
              {option.hint ? (
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
