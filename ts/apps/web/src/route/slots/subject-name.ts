import type { SubjectRefCode } from "../../../../../packages/agent-contracts/src/subject-ref.ts";
export { subjectName } from "../../../../../packages/agent-contracts/src/subject-ref.ts";
export type SubjectNamer = (code: SubjectRefCode) => string | null;
