import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import type { NoRunBranch } from "@pe/ducts-domain/no-runs";
import type { SubjectPart } from "@pe/kit/lang/subject-text";

/** No-run reasons already identify their subject; only compound/free explanations need parsing. */
export function noRunParts(branch: NoRunBranch, snapshot: DuctSnapshot): SubjectPart[] {
  const parts: SubjectPart[] = [];
  for (const reason of branch.reasons) {
    if (parts.length) parts.push("; ");
    const element = [...snapshot.nodes, ...snapshot.segments].find((e) => e.id === reason.at);
    if (reason.kind === "open") {
      // The reason's connector disambiguates multiple open ends on the same element.
      parts.push("Ends open at ", { id: reason.at, connector: reason.connector });
    } else if (reason.kind === "capped") parts.push("Ends capped at ", { id: reason.at });
    else if (reason.kind === "flowless-terminal")
      parts.push("Ends at ", { id: reason.at }, " with no design flow");
    else if (reason.kind === "foreign-terminal")
      parts.push("Ends at ", { id: reason.at }, ` on ${element?.systemName || "no system"}`);
    else parts.push(reason.text);
  }
  return parts;
}

/** Short element names; numbering, rather than an id or a long family path, distinguishes twins. */
export const subjectNamer = elementLabeler;
