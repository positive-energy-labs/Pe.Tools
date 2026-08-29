import { useState } from "react";
import { Search } from "lucide-react";

import { Press } from "#/components/lang/press";
import { Section } from "#/components/lang/section";
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
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

export function UiInputSpecimens() {
  return (
    <Section label="ui · inputs">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Label>parameter scope</Label>
          <Input placeholder="search params…" />
          <Textarea placeholder="why this write is happening…" />
          <InputGroup>
            <InputGroupInput placeholder="search…" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="search">
                <Search />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <SelectSpecimen />
          <ComboboxSpecimen />
        </div>
        <div className="h-64">
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
      </div>
    </Section>
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
      <div ref={anchorRef} className="inline-flex">
        <ComboboxTrigger
          title="Category"
          render={<Press className="inline-flex h-7 w-40 items-center justify-between" />}
        >
          <span className="overflow-hidden">{picked?.label ?? "category"}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef} className="min-w-52">
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
