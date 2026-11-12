import type { SubjectRefCode } from "@pe/agent-contracts";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { regionCode } from "./rows";

/** The room's one SubjectRef (`./rows.ts`), typed for the kit's attention as well. */
export const regionSubject = (guid: string) => regionCode(guid) as SubjectRefCode & SubjectKey;
