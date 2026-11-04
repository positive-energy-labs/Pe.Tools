/** Test support: one Work literal cut into the ducts and fans Works by segment, then joined (`ductsDesign`). */
import {
  ductsDocumentSchema,
  fansDocumentSchema,
  type DuctsRouteDocument,
  type FansRouteDocument,
} from "@pe/agent-contracts";

const fanSegment = (key: string) => key !== "writeIntent" && key in fansDocumentSchema.shape;

export function designOf(raw: Record<string, unknown> = {}): DuctsRouteDocument & Omit<FansRouteDocument, "writeIntent"> {
  const part = (fans: boolean) =>
    Object.fromEntries(Object.entries(raw).filter(([key]) => fanSegment(key) === fans));
  return { ...fansDocumentSchema.parse(part(true)), ...ductsDocumentSchema.parse(part(false)) };
}
