import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { Worksharing } from "./review-contract";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The commit's borrow count; null when the document is not workshared or nothing new is borrowed. */
export const borrowWords = (w: Worksharing | null | undefined) => {
  const n = w?.elements.filter((e) => e.status === "borrows").length ?? 0;
  return w && (n || w.creates.length) ? `borrows ${plural(n + w.creates.length, "element")}` : null;
};

/** What committing does to the central: every element it borrows, held until the person syncs or relinquishes. */
export function WorksharingNote({ worksharing: w }: { worksharing: Worksharing }) {
  const borrows = w.elements.filter((e) => e.status === "borrows");
  const blocked = w.elements.filter((e) => e.status === "blocked");
  const central = w.cloud ? "cloud central" : "central";
  const list = useList({
    items: [
      ...borrows.map((e) => ({ key: `borrow:${e.id}`, label: `borrows ${e.name}` })),
      ...w.creates.map((name) => ({ key: `create:${name}`, label: `creates ${name}` })),
    ],
    keyOf: (row) => row.key,
    search: (row) => ({ text: [row.label] }),
    select: "none",
  });
  return (
    <section aria-label="Worksharing" className="flex flex-col">
      <OutcomeLine
        kind="advisory"
        label={
          borrowWords(w)
            ? `workshared: commit ${borrowWords(w)} from the ${central}`
            : `workshared: you already own every element this commit changes`
        }
        says="they stay borrowed until you sync with central or relinquish"
      />
      <PlainList
        list={list}
        aria-label="Borrowed and created elements"
        row={(row) => ({ label: row.label })}
        empty={{ message: "No new borrowing", exit: "All changed elements are already owned" }}
      />
      {blocked.map((e) => (
        <OutcomeLine
          key={e.id}
          kind="refused"
          label={`${e.name} is borrowed by ${e.owner ?? "another user"}`}
          says="Revit refuses this write until they sync or relinquish"
        />
      ))}
    </section>
  );
}

