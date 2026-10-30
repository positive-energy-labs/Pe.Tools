/** Family's model projections and pane memory. The graph mount owns acquisition, Work and verbs. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  familyEvidenceSchema,
  settingsCandidate,
  settingsFieldDirectives,
  settingsFieldSegments,
  transitionPatches,
  type ActionReceipt,
  type FamilyDraft,
  type PodMember,
} from "@pe/agent-contracts";
import { z } from "zod";
import type { TableState } from "@pe/kit/table/model";
import type { CellWire } from "#/components/work/band";
import type { GraphMount } from "#/shell/mount";
import { useWork } from "@pe/kit/lang/work";
import { familyGraph, type FamilyPage } from "./graph";
import { readingValue, type FamilySpecReading } from "./sources";
import { familySource } from "./source";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "./model";
import { draftToPatches, FAMILY_CELLS } from "./project";
import { familyEditBuffer } from "./edit-buffer";
import { displaySpec } from "./spec";
import { projectBuildReceipt } from "./build";
import type { FamilySnapshot } from "./types";

export type FamilyMount = GraphMount<FamilyPage, FamilyDraft>;
export type Inspect = { kind: "part"; slug: string } | { kind: "param"; name: string } | null;
export type Binding = { slug: string; property: string } | null;
export type PickerState = { open: string | null; level: string | null; query: string };
type Setter<A> = A | ((previous: A) => A);
const next = <A>(value: Setter<A>, previous: A): A =>
  typeof value === "function" ? (value as (previous: A) => A)(previous) : value;
const inspectOf = (text: string): Inspect =>
  text.startsWith("part:")
    ? { kind: "part", slug: text.slice(5) }
    : text.startsWith("param:")
      ? { kind: "param", name: text.slice(6) }
      : null;
const inspectorOf = (value: Inspect) =>
  !value ? "" : value.kind === "part" ? `part:${value.slug}` : `param:${value.name}`;
const noEdit = { draft: null, failure: null };
const noSubscribe = () => () => {};

export function useFamilyStore(owner: FamilyMount) {
  const scope = {
    ...owner.snapshot(),
    page: owner.view.read().page,
    readings: Object.fromEntries(
      Object.keys(familyGraph.readings).map((id) => [id, owner.readings.get(id)]),
    ),
  };
  const { page, work, target } = scope;
  const member = useMemo<PodMember | null>(
    () => (page.pod && page.path ? { pod: page.pod, path: page.path } : null),
    [page.pod, page.path],
  );
  const table = useMemo<TableState>(
    () => ({ sorts: page.sort, query: page.query, hiddenColumns: page.hidden }),
    [page.sort, page.query, page.hidden],
  );
  const inspect = useMemo(() => inspectOf(page.inspector), [page.inspector]);
  const drillType = page.drill || null;
  const run = useCallback(
    async (id: string, input: unknown = {}) => {
      const result = await owner.control(id, input).run();
      return "refusal" in result ? result.refusal : null;
    },
    [owner],
  );
  const write = useCallback<CellWire["write"]>(
    (patches, expectedRevision = owner.snapshot().work?.handle.revision ?? -1) =>
      run("edit", { patches, expectedRevision }),
    [owner, run],
  );
  const edits = useMemo(
    () => (work ? familyEditBuffer(work.handle.key, write) : null),
    [work?.handle.key, write],
  );
  const editState = useSyncExternalStore(
    edits?.subscribe ?? noSubscribe,
    edits?.getSnapshot ?? (() => noEdit),
    edits?.getSnapshot ?? (() => noEdit),
  );
  useWork(editState.draft !== null && editState.failure === null, "saving…");
  useEffect(() => {
    if (work) edits?.observe(work.handle.revision);
  }, [edits, work?.handle.revision]);
  const flush = useCallback(async () => {
    await edits?.flush();
  }, [edits]);
  const fields = work?.doc.cells ?? {};
  const draftSnapshot = useCallback(
    (edited: boolean): FamilySnapshot | null => {
      if (!work?.doc.reading) return null;
      try {
        const rawContent = edited
          ? settingsCandidate(work.doc.reading, work.doc.cells)
          : work.doc.reading;
        return {
          ...(member ? { member } : {}),
          sha256: null,
          rawContent,
          composedContent: rawContent,
          validation: { isValid: true, issues: [] },
        };
      } catch (error) {
        return {
          ...(member ? { member } : {}),
          sha256: null,
          rawContent: work.doc.reading,
          composedContent: null,
          validation: {
            isValid: false,
            issues: [
              {
                message: error instanceof Error ? error.message : String(error),
                severity: "error",
                path: "$",
              },
            ],
          },
        };
      }
    },
    [work?.doc, member],
  );
  const snapshot = useMemo(() => draftSnapshot(false), [draftSnapshot]);
  const authored = useMemo((): unknown => {
    try {
      return snapshot ? JSON.parse(snapshot.rawContent.replace(/^\uFEFF/, "")) : null;
    } catch {
      return null;
    }
  }, [snapshot]);
  const wire = useMemo<CellWire>(
    () => ({
      segment: FAMILY_CELLS,
      revision: work?.handle.revision ?? null,
      write: async (patches, revision) => {
        await flush();
        return write(patches, revision);
      },
      lockOf: (key) =>
        page.stage === "history" ? "History is inspection only" : familyLockOf(authored)(key),
    }),
    [work?.handle.revision, write, flush, authored, page.stage],
  );
  const [memory, setMemory] = useState({
    drill: { sorts: [], query: "" } as TableState,
    docZoom: 1,
    stageType: "Standard",
    focus: null as Focus,
    focusedProposal: null as string | null,
    pinnedParam: null as string | null,
    binding: null as Binding,
    picker: { open: null, level: null, query: "" } as PickerState,
    sharedEdit: null as { pointer: string; directives: string[] } | null,
    receipt: null as { verb: string; text: string; at: number } | null,
  });
  const patch = useCallback(
    (value: Partial<typeof memory>) => setMemory((current) => ({ ...current, ...value })),
    [],
  );
  const capturedResult = readingValue<ActionReceipt[]>(scope.readings.captureReceipt)?.[0];
  const captured = useMemo(() => {
    const parsed = z
      .object({
        member: z.object({ pod: z.string(), path: z.string() }),
        evidence: familyEvidenceSchema,
      })
      .safeParse(capturedResult?.state === "succeeded" ? capturedResult.result : null);
    return parsed.success ? parsed.data : null;
  }, [capturedResult]);
  const evidence =
    captured && captured.member.pod === member?.pod && captured.member.path === member.path
      ? captured.evidence
      : null;
  const attached = work?.doc.spec;
  const fileSpec = readingValue<FamilySpecReading>(scope.readings.spec);
  const spec = useMemo(() => {
    if (!member) return null;
    const doc =
      attached?.member.pod === member.pod && attached.member.path === member.path
        ? attached.doc
        : fileSpec?.member.pod === member.pod && fileSpec.member.path === member.path
          ? fileSpec.doc
          : null;
    return doc ? displaySpec(doc, member) : null;
  }, [attached, fileSpec, member]);
  const lane = useMemo(
    () => familySource(snapshot, evidence, fields, spec ?? undefined),
    [snapshot, evidence, fields, spec],
  );
  const saved = useMemo(() => savedFrom(initialDraft(lane.world)), [lane]);
  const draft = useMemo(
    () => editState.draft ?? initialDraft(familySource(draftSnapshot(true), evidence).world),
    [editState.draft, draftSnapshot, evidence],
  );
  const documentTarget = target.kind === "document" ? target.ref : null;
  const documentScope = useMemo(
    () =>
      documentTarget
        ? { bridgeSessionId: documentTarget.session, openDocumentId: documentTarget.openId }
        : undefined,
    [documentTarget?.session, documentTarget?.openId],
  );
  const buildReceipts = readingValue<ActionReceipt[]>(scope.readings.buildReceipt);
  const buildReceipt = buildReceipts?.[0]
    ? projectBuildReceipt(buildReceipts, buildReceipts[0].id)
    : null;
  const actions = useMemo(
    () => ({
      setDraft: (value: Setter<Draft>): string | void => {
        if (page.stage === "history") return "History is inspection only";
        if (!lane.document || !edits || !work) return "Read the family before editing fields";
        const previous = edits.getSnapshot().draft ?? draft;
        const updated = next(value, previous);
        const patches = draftToPatches(lane.document.model, updated, previous);
        for (const entry of patches) {
          const pointer = String(entry.path[1]);
          const directives = settingsFieldDirectives(authored, settingsFieldSegments(pointer));
          if (directives) {
            const text = `Edit the shared source for ${pointer}. The profile contains a pointer; no local edit was staged.`;
            patch({
              sharedEdit: { pointer, directives },
              receipt: { verb: "page", text, at: Date.now() },
            });
            return text;
          }
        }
        for (const id of updated.cleared.filter((id) => !previous.cleared.includes(id)))
          patches.push(
            ...transitionPatches([FAMILY_CELLS], id, fields[id] ?? {}, { kind: "unsuggest" }),
          );
        edits.stage(updated, patches, work.handle.revision);
      },
      setOverlay: (value: Setter<Overlay>) =>
        owner.view.setPage({ overlay: next(value, page.overlay) }),
      setTable: (value: Setter<TableState>) => {
        const updated = next(value, table);
        owner.view.setPage(
          { query: updated.query, sort: updated.sorts, hidden: updated.hiddenColumns ?? [] },
          { history: "replace" },
        );
      },
      setDrill: (value: Setter<TableState>) =>
        setMemory((c) => ({ ...c, drill: next(value, c.drill) })),
      setDocMode: (value: Setter<"text" | "sheet">) =>
        owner.view.setPage({ doc: next(value, page.doc) }),
      setDocZoom: (value: Setter<number>) =>
        setMemory((c) => ({ ...c, docZoom: next(value, c.docZoom) })),
      setDrillType: (value: Setter<string | null>) =>
        owner.view.setPage({ drill: next(value, drillType) ?? "" }),
      setStageType: (value: Setter<string>) =>
        setMemory((c) => ({ ...c, stageType: next(value, c.stageType) })),
      setFocus: (value: Setter<Focus>) => setMemory((c) => ({ ...c, focus: next(value, c.focus) })),
      setFocusedProposal: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, focusedProposal: next(value, c.focusedProposal) })),
      setPinnedParam: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, pinnedParam: next(value, c.pinnedParam) })),
      setInspect: (value: Setter<Inspect>) =>
        owner.view.setPage({ inspector: inspectorOf(next(value, inspect)) }),
      setBinding: (value: Setter<Binding>) =>
        setMemory((c) => ({ ...c, binding: next(value, c.binding) })),
      setPicker: (value: Setter<PickerState>) =>
        setMemory((c) => ({ ...c, picker: next(value, c.picker) })),
      say: (text: string) => patch({ receipt: { verb: "page", text, at: Date.now() } }),
      flush,
      async attachSpec(this: void, file: File) {
        if (!member) throw Error("Capture the family into a pod before attaching its cut sheet");
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve((typeof reader.result === "string" ? reader.result : "").split(",")[1]!);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const refused = await run("attach-spec", {
          member,
          source: { fileName: file.name, base64 },
        });
        if (refused) throw Error(refused.message);
      },
    }),
    [
      page,
      lane,
      edits,
      work,
      draft,
      fields,
      authored,
      patch,
      owner,
      table,
      drillType,
      inspect,
      flush,
      member,
      run,
    ],
  );
  return {
    owner,
    scope,
    member,
    profile: member?.path ?? "",
    target: documentTarget?.session ?? "",
    documentScope,
    evidence,
    captured,
    lane,
    snapshot,
    review: { revision: work?.handle.revision ?? null },
    fields,
    wire,
    saved,
    draft,
    buildReceipt,
    ...memory,
    overlay: page.overlay,
    table,
    docMode: page.doc,
    drillType,
    inspect,
    busy: owner.busy(),
    failure: editState.failure,
    editFailure: editState.failure,
    actions,
  };
}
export type FamilyStore = ReturnType<typeof useFamilyStore>;
export const familyLockOf =
  (authored: unknown) =>
  (key: string): string | null =>
    authored != null && settingsFieldDirectives(authored, settingsFieldSegments(key))
      ? `${key} points to a shared source — edit that source instead`
      : null;
