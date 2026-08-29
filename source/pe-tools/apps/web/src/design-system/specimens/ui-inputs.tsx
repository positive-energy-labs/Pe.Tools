import { useState } from "react";
import { Search } from "lucide-react";

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
} from "#/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "#/components/ui/command";
import { Input } from "#/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  inputGroupRecipe,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectRecipe,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";

import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

export function UiInputSpecimens() {
  return (
    <>
      <SpecimenFrame name="Combobox" importPath="#/components/ui/combobox">
        <ComboboxSpecimen />
      </SpecimenFrame>
      <SpecimenFrame name="Command" importPath="#/components/ui/command">
        <div className="h-52 w-72">
          <Command>
            <CommandInput placeholder="search…" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup heading="categories">
                {CATEGORY_OPTIONS.slice(0, 4).map((option, index) => (
                  <CommandItem key={option.value}>
                    {option.label}
                    <CommandShortcut>⌘{index + 1}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="Input" importPath="#/components/ui/input">
        <div className="grid w-80 grid-cols-2 gap-3">
          <Input placeholder="search params…" />
          <Input defaultValue="36 in" />
          <Input defaultValue="36 in" disabled />
          <Input defaultValue="36 in" aria-invalid />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="InputGroup"
        importPath="#/components/ui/input-group"
        recipe={inputGroupRecipe}
        render={(props) => (
          <div className="w-56">
            <InputGroup>
              <InputGroupAddon
                align={props.align as "inline-start" | "inline-end" | "block-start" | "block-end"}
              >
                <InputGroupButton
                  size={props.size as "xs" | "sm" | "icon-xs" | "icon-sm"}
                  aria-label="search"
                >
                  <Search />
                </InputGroupButton>
              </InputGroupAddon>
              <InputGroupInput placeholder="search…" />
            </InputGroup>
          </div>
        )}
      />
      <SpecimenFrame name="Label" importPath="#/components/ui/label">
        <div className="flex items-center gap-3">
          <Label>parameter scope</Label>
          <Label aria-disabled>disabled label</Label>
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Select"
        importPath="#/components/ui/select"
        recipe={selectRecipe}
        render={() => <SelectSpecimen />}
      />
      <SpecimenFrame name="Textarea" importPath="#/components/ui/textarea">
        <div className="grid w-[32rem] grid-cols-2 gap-3">
          <Textarea placeholder="why this write is happening…" />
          <Textarea defaultValue="backfill fire ratings" disabled />
        </div>
      </SpecimenFrame>
    </>
  );
}

function ComboboxSpecimen() {
  const [picked, setPicked] = useState<CategoryOption | null>(null);
  const anchorRef = useComboboxAnchor();
  return (
    <Combobox
      items={CATEGORY_OPTIONS}
      value={picked}
      onValueChange={(option: CategoryOption | null) => setPicked(option)}
      itemToStringLabel={(option: CategoryOption) => option.label}
    >
      <div
        ref={anchorRef}
        className="inline-flex w-40 [&>button]:w-full [&>button]:justify-between"
      >
        <ComboboxTrigger
          title="Category"
          render={<Press tone="quiet" size="value" state="selected" />}
        >
          <span className="overflow-hidden">{picked?.label ?? "category"}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef}>
        <ComboboxInput placeholder="search category…" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: CategoryOption) => (
            <ComboboxItem key={option.value} value={option} className="pr-7">
              <span className="overflow-hidden">{option.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function SelectSpecimen() {
  const [value, setValue] = useState("doors");
  return (
    <div className="w-40">
      <Select value={value} onValueChange={(next: string | null) => setValue(next ?? "")}>
        <SelectTrigger>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
