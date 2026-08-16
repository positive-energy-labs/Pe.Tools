/** The one inline-edit primitive /family uses — click to type, Enter commits, Esc abandons.
 *  Shared by the anatomy's dimension chips and the matrix's value cells so an edit feels the
 *  same wherever it is made; an empty draft commits nothing rather than writing "". */
import { useState } from "react";

export function EditableValue({
  value,
  onCommit,
  className = "",
  title,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null)
    return (
      <button
        type="button"
        title={title ?? "Click to edit"}
        className={`cursor-text rounded-[2px] px-0.5 tabular-nums hover:bg-[var(--pe-blue)]/10 ${className}`}
        onClick={() => setDraft(value)}
      >
        {value}
      </button>
    );
  return (
    <input
      autoFocus
      value={draft}
      size={Math.max(4, draft.length)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim()) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
      className={`h-7 border-0 bg-transparent px-0.5 tabular-nums outline-none focus:bg-[var(--pe-blue)]/5 ${className}`}
    />
  );
}
