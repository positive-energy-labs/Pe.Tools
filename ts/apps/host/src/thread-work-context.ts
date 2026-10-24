import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  addressSchema,
  bindWork,
  documentRefSchema,
  documentRequestSchema,
  routeAddress,
  sameAddress,
  workKey,
  workKeySchema,
  type Address,
  type DocumentRef,
  type DocumentRequest,
  type RouteKey,
} from "@pe/agent-contracts";

interface DocumentObservation {
  ref: DocumentRef;
  address: Address | null;
  name: string;
}
export type ObserveDocument = (request: DocumentRequest) => DocumentObservation | null;

/** Remembered context never participates in resolution, native consent, or turn targeting. */
const threadWorkContextSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      address: addressSchema.nullable(),
      refs: z.array(documentRefSchema),
    }),
  ),
  works: z.array(z.object({ key: workKeySchema, documentId: z.string().min(1).nullable() })),
});
export type ThreadWorkContext = z.infer<typeof threadWorkContextSchema>;
const emptyWorkContext = (): ThreadWorkContext => ({ documents: [], works: [] });
export const readWorkContext = (value: unknown): ThreadWorkContext | null =>
  value === undefined
    ? emptyWorkContext()
    : (threadWorkContextSchema.safeParse(value).data ?? null);

export const sameDocumentRef = (a: DocumentRef | null, b: DocumentRef | null) =>
  a !== null && b !== null && a.session === b.session && a.openId === b.openId;

function rememberDocument(
  context: ThreadWorkContext,
  input: { address: Address | null; ref: DocumentRef | null; name?: string },
): { context: ThreadWorkContext; document: ThreadWorkContext["documents"][number] | null } {
  const matches = context.documents.filter(
    (doc) =>
      (input.address !== null && doc.address !== null && sameAddress(doc.address, input.address)) ||
      ((input.address === null || doc.address === null) &&
        doc.refs.some((ref) => sameDocumentRef(ref, input.ref))),
  );
  if (matches.length > 1) return { context, document: null };
  const held = matches[0];
  const document = {
    id: held?.id ?? randomUUID(),
    name: input.name?.trim() || held?.name || input.address?.split(/[\\/]/).at(-1) || "Document",
    address: input.address ?? held?.address ?? null,
    refs:
      input.ref && !held?.refs.some((ref) => sameDocumentRef(ref, input.ref))
        ? [...(held?.refs ?? []), input.ref]
        : (held?.refs ?? []),
  };
  return {
    document,
    context: {
      ...context,
      documents: held
        ? context.documents.map((doc) => (doc.id === held.id ? document : doc))
        : [...context.documents, document],
    },
  };
}

export function rememberTarget(
  context: ThreadWorkContext,
  request: DocumentRequest,
  label: string | undefined,
  observe?: ObserveDocument,
) {
  const live = observe?.(request);
  return rememberDocument(context, {
    address: live?.address ?? (request.kind === "named" ? request.address : null),
    ref: live?.ref ?? (request.kind === "open" ? request.ref : null),
    name: live?.name || label,
  });
}

/** A visited Place links existing Work; closing the tab never deletes that relationship. */
export function rememberPlace(
  context: ThreadWorkContext,
  route: RouteKey,
  link: string,
  observe?: ObserveDocument,
): ThreadWorkContext {
  const at = routeAddress(route).read(
    Object.fromEntries(new URL(link, "http://place.invalid").searchParams),
  );
  let document: ThreadWorkContext["documents"][number] | null = null;
  if (at.carry.target) {
    const namedAddress = addressSchema.safeParse(at.carry.target);
    if (namedAddress.success) {
      ({ context, document } = rememberDocument(context, {
        address: namedAddress.data,
        ref: null,
      }));
    } else {
      try {
        const request = documentRequestSchema.safeParse(JSON.parse(at.carry.target));
        if (request.success)
          ({ context, document } = rememberTarget(context, request.data, undefined, observe));
      } catch {
        // A legacy session shorthand is not enough to invent a document relationship.
      }
    }
  }
  const workspace =
    at.carry.work ||
    ("workspaceId" in at.page && typeof at.page.workspaceId === "string"
      ? at.page.workspaceId
      : undefined);
  if (at.carry.target && !document) return context;
  const key = bindWork(
    route,
    document?.address ?? null,
    workspace,
    document?.address ? undefined : document?.refs.at(-1),
  );
  const id = workKey(key);
  const documentId = document?.id ?? null;
  return context.works.some((held) => workKey(held.key) === id && held.documentId === documentId)
    ? context
    : { ...context, works: [...context.works, { key, documentId }] };
}
