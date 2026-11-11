import { subjectCode } from "@pe/agent-contracts";
import type { SubjectKey } from "@pe/kit/lang/attention";

/** The carrier GUID survives replacement of the Revit FilledRegion. */
export const regionSubject = (guid: string): SubjectKey =>
  subjectCode({ keyKind: "region", key: guid }) as SubjectKey;
