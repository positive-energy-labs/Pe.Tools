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
  comboboxRecipe,
  useComboboxAnchor,
} from "#/components/lang/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  commandRecipe,
} from "#/components/lang/command";
import { Input, inputRecipe } from "#/components/lang/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  inputGroupRecipe,
} from "#/components/lang/input-group";
import { Label, labelRecipe } from "#/components/lang/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectRecipe,
} from "#/components/lang/select";
import { Textarea, textareaRecipe } from "#/components/lang/textarea";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";
import { RecipeGrid } from "./recipe-grid";

type Option = (typeof CATEGORY_OPTIONS)[number];

export function UiInputSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Combobox"
        importPath="#/components/lang/combobox"
        recipe={comboboxRecipe}
        render={() => <ComboboxSpecimen />}
      />
      <RecipeGrid
        name="Command"
        importPath="#/components/lang/command"
        recipe={commandRecipe}
        render={() => (
          <div className="h-52 w-72">
            <Command>
              <CommandInput placeholder="search" />
              <CommandList>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup heading="categories">
                  {CATEGORY_OPTIONS.slice(0, 2).map((option, index) => (
                    <CommandItem key={option.value}>
                      {option.label}
                      <CommandShortcut>{index + 1}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}
      />
      <RecipeGrid
        name="Input"
        importPath="#/components/lang/input"
        recipe={inputRecipe}
        render={(props) => (
          <Input surface={props.surface as "field" | "embedded"} placeholder="search params" />
        )}
      />
      <RecipeGrid
        name="InputGroup"
        importPath="#/components/lang/input-group"
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
              <InputGroupInput placeholder="search" />
            </InputGroup>
          </div>
        )}
      />
      <RecipeGrid
        name="Label"
        importPath="#/components/lang/label"
        recipe={labelRecipe}
        render={() => <Label>parameter scope</Label>}
      />
      <RecipeGrid
        name="Select"
        importPath="#/components/lang/select"
        recipe={selectRecipe}
        render={() => <SelectSpecimen />}
      />
      <RecipeGrid
        name="Textarea"
        importPath="#/components/lang/textarea"
        recipe={textareaRecipe}
        render={(props) => (
          <Textarea
            size={props.size as "compact" | "normal" | "tall"}
            surface={props.surface as "field" | "embedded"}
            placeholder="why this write is happening"
          />
        )}
      />
    </>
  );
}

function ComboboxSpecimen() {
  const [picked, setPicked] = useState<Option | null>(null);
  const anchor = useComboboxAnchor();
  return (
    <Combobox
      items={CATEGORY_OPTIONS}
      value={picked}
      onValueChange={(option: Option | null) => setPicked(option)}
      itemToStringLabel={(option: Option) => option.label}
    >
      <div ref={anchor} className="inline-flex w-40 [&>button]:w-full">
        <ComboboxTrigger render={<Press tone="quiet" size="value" state="selected" />}>
          {picked?.label ?? "category"}
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchor}>
        <ComboboxInput placeholder="search" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
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
  );
}
