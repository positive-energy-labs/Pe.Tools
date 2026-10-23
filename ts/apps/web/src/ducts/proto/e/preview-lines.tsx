import type { PreviewLine } from "../../inbox-rows";
import { SubjectText } from "@pe/kit/lang/subject-text";

/** The list under a preview's counts: one line per item the verb would change, or refuse and why. */
export function PreviewLines({ lines }: { lines: readonly PreviewLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-preview-lines="">
      {lines.map((line) => (
        <li
          key={line.key}
          data-outcome={line.state ?? undefined}
          data-tone={line.state === "refused" ? "alarm" : undefined}
          className="t-small"
        >
          <SubjectText text={line.text} />
          {line.state === "refused" ? (
            <span className="ml-1.5 text-ink-2">
              refused: <SubjectText text={line.reason ?? "no reason given"} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
