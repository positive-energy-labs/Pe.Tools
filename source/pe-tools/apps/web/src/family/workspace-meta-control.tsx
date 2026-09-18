import { Switcher } from "#/components/lang/switcher";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "#/components/lang/combobox";
import type { GeomMeta } from "#/family/world";
import { useFamilyWorkspace } from "#/family/workspace-context";

export function FamilyMetaControl({ slug, meta }: { slug: string; meta: GeomMeta }) {
  const { draft, editMeta } = useFamilyWorkspace();
  const value = draft.geom[slug]?.meta[meta.key] ?? meta.value;
  if (meta.control === "read")
    return (
      <span
        title={`${meta.note} READ-ONLY — a box you could type in would be claiming an edit that nothing downstream would actually make.`}
      >
        {value} <span>reported</span>
      </span>
    );
  if (meta.control === "toggle")
    return (
      <Switcher
        ariaLabel={meta.label}
        value={value}
        onChange={(option) => editMeta(slug, meta.key, option)}
        options={(meta.options ?? []).map((option) => ({
          value: option,
          label: option,
          title:
            value === option
              ? `${meta.label} is ${option} today. ${meta.note}`
              : `Set ${meta.label} to ${option}. ${meta.note}`,
        }))}
      />
    );
  return (
    <Combobox
      items={meta.options ?? []}
      value={value}
      onValueChange={(option: string | null) => option && editMeta(slug, meta.key, option)}
      itemToStringLabel={(option: string) => option}
    >
      <ComboboxTrigger fill title={meta.note} aria-label={meta.label}>
        {value}
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList>
          {(option: string) => (
            <ComboboxItem key={option} value={option}>
              {option}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
