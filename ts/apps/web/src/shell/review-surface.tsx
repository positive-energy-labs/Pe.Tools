import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Popover, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { borrowWords, WorksharingNote } from "./mount-verbs";
import type { Worksharing } from "./verbs";

/** One review portal for admitted and legacy projections. Authority stays with the owner. */
export function ReviewSurface({
  label,
  sentence,
  rows,
  worksharing,
  enabled,
  refusal,
  confirm,
  cancel,
}: {
  label: string;
  sentence: string | null;
  rows: readonly string[];
  worksharing?: Worksharing | null;
  enabled: boolean;
  refusal?: string | null;
  confirm(this: void): void;
  cancel(this: void): void;
}) {
  const [anchor] = useState(() => document.activeElement);
  const borrows = borrowWords(worksharing);
  const commit = `Commit ${label}${borrows ? ` · ${borrows}` : ""}`;
  return (
    <Popover
      open
      replaceOnSiblingOpen={false}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") cancel();
        else details.cancel();
      }}
    >
      <SubjectPopoverContent
        anchor={anchor}
        aria-label={`${label} review`}
        className="flex max-h-(--available-height) flex-col gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-0 overflow-y-auto">
          <output>{sentence}</output>
          {rows.length > 0 && (
            <span role="list" className="flex flex-col">
              {rows.map((row, index) => (
                <span role="listitem" key={index}>
                  {row}
                </span>
              ))}
            </span>
          )}
          {worksharing && <WorksharingNote worksharing={worksharing} />}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Button
            kind="commit"
            label={commit}
            refusal={refusal ?? (!enabled ? "This route is inactive" : null)}
            onClick={confirm}
          >
            {commit}
          </Button>
          <Button label={`Cancel ${label}`} onClick={() => cancel()}>
            Cancel
          </Button>
        </div>
      </SubjectPopoverContent>
    </Popover>
  );
}
