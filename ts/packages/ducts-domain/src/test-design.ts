/** Test support: one Work literal cut into the ducts and fans Works by segment, then joined (`ductsDesign`). */
import {
  ductsDesign,
  ductsDocumentSchema,
  fansDocumentSchema,
  type DuctsDesign,
} from "@pe/agent-contracts";

const fanSegment = (key: string) => key !== "writeIntent" && key in fansDocumentSchema.shape;

export function designOf(raw: Record<string, unknown> = {}): DuctsDesign {
  const part = (fans: boolean) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => fanSegment(key) === fans));
  return ductsDesign(ductsDocumentSchema.parse(part(false)), fansDocumentSchema.parse(part(true)));
}
