import { uploadBlob } from "../../../../packages/mcps/src/shared/blob-client.ts";
import { familyPageSchema } from "./page";
/** Family's domain projections and pane memory; the typed shell owns acquisition, Work and verbs. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useRef } from "react";
import {
  settingsCandidate,
  settingsFieldDirectives,
  settingsFieldSegments,
  cellPatches,
  workKey,
  workHandleSchema,
  type PodMember,
} from "@pe/agent-contracts";
import { useValue } from "@pe/kit/lang/collection";
import type { TableState } from "@pe/kit/table/model";
import type { CellWire } from "#/components/work/band";
import { useWork } from "@pe/kit/lang/work";
import { familySource } from "./source";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "./model";
import { draftToPatches, FAMILY_CELLS } from "./project";
import { familyEditBuffer } from "./edit-buffer";
import { displaySpec } from "./spec";
import type { FamilySnapshot, EvidenceSlice } from "./types";
import { member as memberOf, type FamilyContext } from "./route";

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

export function useFamilyStore(ctx: FamilyContext) {
  const current=useRef(ctx);current.current=ctx;
  const data=useValue(ctx.value);
  const page=familyPageSchema.parse(ctx.page.read());
  const target=ctx.target??{kind:"host" as const};
  const work=data?.handle?{handle:workHandleSchema.parse(data.handle),doc:data.familyWork}:null;
  const scope={page,target,work};
  const setPage=(patch:Record<string,unknown>)=>{
    const {stage,pane,overlay,drill,inspector,doc,...query}=patch;
    ctx.page.query(query);
    ctx.page.pose(Object.fromEntries(Object.entries({stage,pane,overlay,drill,inspector,doc}).filter(([,v])=>v!==undefined)));
  };
  // The subject is the open family (ADR 0035 rule 1): its saved member, or none for the Work's own draft.
  const picked = memberOf(ctx.page.read());
  const member = useMemo<PodMember | null>(() => picked, [picked?.pod, picked?.path]);
  const table = useMemo<TableState>(
    () => ({
      sorts: page.sort.columns,
      query: page.query,
      hiddenColumns: Object.keys(page.hidden),
    }),
    [page.sort, page.query, page.hidden],
  );
  const inspect = useMemo(() => inspectOf(page.inspector), [page.inspector]);
  const drillType = page.drill || null;
  const run=useCallback(async(id:string,input:unknown={})=>{
    try {await current.current.write(id === "attach-spec"?"attach":id).run(input);return null;}
    catch(error){return {message:error instanceof Error?error.message:String(error)};}
  },[]);
  const identity=work?workKey(work.handle.key):null;
  const write=useCallback<CellWire["write"]>((patches,expectedRevision=work?.handle.revision??-1)=>{
    const latest=current.current;
    const handle=latest.value.value?.handle?workHandleSchema.parse(latest.value.value.handle):null;
    if(!handle||workKey(handle.key)!==identity||handle.revision!==expectedRevision)
      return Promise.resolve({code:"stale-work",message:"Family Work changed; review the current cells"});
    return latest.cells.patch(patches,{label:"Edit family cells"});
  },[identity,work?.handle.revision]);
  // CHEAT(K gaps 1/4): grouped domain edits retain their unacknowledged input until typed Work observes it.
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
  const profile = ctx.value.current ? data?.profile : null;
  // Selecting a saved member is inspection; only an explicit Open replaces the document draft.
  const snapshot = useMemo(() => {
    if (member)
      return profile?.member.pod === member.pod && profile.member.path === member.path
        ? profile
        : null;
    return draftSnapshot(false);
  }, [draftSnapshot, member, profile]);
  const inspecting = !!member && snapshot?.rawContent !== work?.doc.reading;
  const fields = inspecting ? {} : (work?.doc.cells ?? {});
  const authored = useMemo((): unknown => {
    try {
      return snapshot ? JSON.parse(snapshot.rawContent.replace(/^\uFEFF/, "")) : null;
    } catch (error) {
      console.warn("ts/apps/web/src/family/store.ts: fallback after failure", error);
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
        inspecting
          ? "Open this saved member before editing its cells"
          : page.stage === "history"
            ? "History is inspection only"
            : familyLockOf(authored)(key),
    }),
    [work?.handle.revision, write, flush, authored, page.stage, inspecting],
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
  // Capture/build receipts belong to shell History; this Value exposes no native evidence sheet.
  const evidence: EvidenceSlice | null = null;
  const attached = work?.doc.spec;
  const fileSpec = ctx.value.current ? data?.spec : null;
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
    () =>
      inspecting
        ? initialDraft(lane.world)
        : (editState.draft ?? initialDraft(familySource(draftSnapshot(true), evidence).world)),
    [editState.draft, draftSnapshot, evidence, inspecting, lane],
  );
  const documentTarget = target.kind === "document" ? target.ref : null;
  const documentScope = useMemo(
    () =>
      documentTarget
        ? { bridgeSessionId: documentTarget.session, openDocumentId: documentTarget.openId }
        : undefined,
    [documentTarget?.session, documentTarget?.openId],
  );
  const actions = useMemo(
    () => ({
      setDraft: (value: Setter<Draft>): string | void => {
        if (page.stage === "history") return "History is inspection only";
        if (inspecting) return "Open this saved member before editing its cells";
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
        for (const id of updated.cleared.filter(
          (id) =>
            !previous.cleared.includes(id) &&
            !patches.some((p) => p.path[1] === id && p.path[2] === "edit" && p.value != null),
        ))
          patches.push(...cellPatches([FAMILY_CELLS], id, fields[id] ?? {}, { kind: "clear" }));
        edits.stage(updated, patches, work.handle.revision);
      },
      setOverlay: (value: Setter<Overlay>) =>
        setPage({ overlay: next(value, page.overlay) }),
      setTable: (value: Setter<TableState>) => {
        const updated = next(value, table);
        setPage(
          {
            query: updated.query,
            sort: { columns: updated.sorts },
            hidden: Object.fromEntries(
              (updated.hiddenColumns ?? []).map((key) => [key, true as const]),
            ),
          },
        );
      },
      setDrill: (value: Setter<TableState>) =>
        setMemory((c) => ({ ...c, drill: next(value, c.drill) })),
      setDocMode: (value: Setter<"text" | "sheet">) =>
        setPage({ doc: next(value, page.doc) }),
      setDocZoom: (value: Setter<number>) =>
        setMemory((c) => ({ ...c, docZoom: next(value, c.docZoom) })),
      setDrillType: (value: Setter<string | null>) =>
        setPage({ drill: next(value, drillType) ?? "" }),
      setStageType: (value: Setter<string>) =>
        setMemory((c) => ({ ...c, stageType: next(value, c.stageType) })),
      setFocus: (value: Setter<Focus>) => setMemory((c) => ({ ...c, focus: next(value, c.focus) })),
      setFocusedProposal: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, focusedProposal: next(value, c.focusedProposal) })),
      setPinnedParam: (value: Setter<string | null>) =>
        setMemory((c) => ({ ...c, pinnedParam: next(value, c.pinnedParam) })),
      setInspect: (value: Setter<Inspect>) =>
        setPage({ inspector: inspectorOf(next(value, inspect)) }),
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
          source: await uploadBlob({ fileName: file.name, base64 }),
        });
        if (refused) throw Error(refused.message);
      },
    }),
    [
      page,
      inspecting,
      lane,
      edits,
      work,
      draft,
      fields,
      authored,
      patch,
      ctx,
      table,
      drillType,
      inspect,
      flush,
      member,
      run,
    ],
  );
  return {
    ctx,
    scope,
    member,
    profile: member?.path ?? "",
    target: documentTarget?.session ?? "",
    documentScope,
    evidence,
    lane,
    snapshot,
    review: { revision: work?.handle.revision ?? null },
    fields,
    wire,
    saved,
    draft,
    ...memory,
    overlay: page.overlay,
    table,
    docMode: page.doc,
    drillType,
    inspect,
    busy:ctx.value.status === "pending"?{key:"read"}:null,
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
