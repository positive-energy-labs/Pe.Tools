import { useContext, useEffect, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { cite, clearCitation, type SubjectReference } from "@pe/kit/lang/attention";
import { z } from "zod";
import { subjectSchema } from "@pe/agent-contracts/route";
import { subjectCode, subjectOf, subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import type { Pointer } from "@pe/agent-contracts";
import { peReadings, type Readings } from "#/host/resource-stream";
import { subjectName } from "../route/slots/subject-name.ts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";

const pointers = z.object({
  pointers: z.array(
    z.object({
      id: z.string(),
      route: z.string(),
      target: z.union([z.string(), z.record(z.string(), z.string())]),
      label: z.string(),
      at: z.string(),
    }),
  ),
});
type Fields = Readonly<Record<string, { role: string; schema: z.ZodType }>>;

/** A place is decoded by the declared subject fields, never by a route-specific snapshot. */
export function pointerRefs(
  target: Pointer["target"],
  fields: Fields,
  doc: string,
): SubjectReference[] {
  const codes =
    typeof target === "string"
      ? [subjectRefCodeSchema.parse(target)]
      : Object.entries(target).flatMap(([key, text]) => {
          const field = fields[key];
          if (field?.role !== "subject") return [];
          const value = field.schema.parse(JSON.parse(text));
          const many = subjectSchema(512).safeParse(value);
          return many.success
            ? many.data.kind === "ids"
              ? many.data.ids
              : []
            : [subjectRefCodeSchema.parse(value)];
        });
  return [
    ...new Set(
      codes.flatMap((code) => {
        const ref = subjectOf(code);
        return [code, ...(ref.sub ? [subjectCode({ ...ref, sub: undefined })] : [])];
      }),
    ),
  ].map((key, index) => ({ doc, key, name: subjectName(key), number: index + 1 }));
}

/** One streamed citation per mounted route; no list, poll, selection or camera write. */
export function PointerCite({
  route,
  thread,
  fields,
  doc,
  readings = peReadings,
}: {
  route: string;
  thread?: string;
  fields: Fields;
  doc: string;
  readings?: Pick<Readings, "subscribe">;
}) {
  const registry = useContext(RegistryContext);
  const currentThread = useContext(WorkbenchContext)?.currentThreadId;
  const boundThread = thread ?? currentThread;
  const [all, setAll] = useState<readonly Pointer[]>([]);
  useEffect(() => {
    setAll([]);
    return boundThread
      ? readings.subscribe({ kind: "thread-head", thread: boundThread }, (frame) => {
          if (frame.kind !== "snapshot") return;
          const parsed = pointers.safeParse(frame.value);
          if (parsed.success) setAll(parsed.data.pointers);
        })
      : undefined;
  }, [boundThread, readings]);
  const refs = all
    .filter((p) => p.route === route)
    .flatMap((p) => {
      try {
        return pointerRefs(p.target, fields, doc);
      } catch {
        return [];
      }
    });
  const key = JSON.stringify(refs);
  useEffect(() => {
    const owner = `pointers:${route}`;
    if (refs.length)
      cite(registry, {
        owner,
        focus: null,
        refs: refs.map((ref, i) => ({ ...ref, number: i + 1 })),
      });
    else clearCitation(registry, owner);
    return () => clearCitation(registry, owner);
    // The serialized refs are the citation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, route, key]);
  return null;
}
