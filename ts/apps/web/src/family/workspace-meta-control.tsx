import { Switcher } from "#/components/lang/switcher";
import { ListPopup } from "#/components/lang/list-popup";
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
    <ListPopup<string>
      anchor="trigger"
      face="fill"
      title={meta.note}
      triggerLabel={meta.label}
      trigger={value}
      aria-label={meta.label}
      items={meta.options ?? []}
      keyOf={(option) => option}
      labelOf={(option) => option}
      select="single"
      selected={[value]}
      empty="no options"
      onPick={(option) => editMeta(slug, meta.key, option)}
      row={(option) => ({ label: option })}
    />
  );
}
