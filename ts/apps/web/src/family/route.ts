import type { ContextOf } from "../route/defaults";
import { command, sessionCommand, queryAction, catalogAction } from "../route/typed-actions.ts";
import { read } from "../route/defaults";
import { z } from "zod";
import { familyDraftRouteState, routeStatePatchSchema, valueRead } from "@pe/agent-contracts";
import { familyPageSchema } from "./page";
import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";
import { route, field } from "../route/defaults";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { familyArgs, familyData } from "@pe/agent-contracts";
import { presentFamilyPlan } from "./review";
import { podMemberCode, podMemberOfCode, type Immutable } from "@pe/agent-contracts";
import { split, subjectSchema } from "../route/defaults";
import { isSpecOf } from "../route/workflow.ts";
import { FAMILY_MODEL_SCHEMA } from "./page";
const address = familyPageSchema.shape;
/** The open family: the subject's one id, a `name` SubjectRef `[pod, path]` over its saved member (ADR 0035 rule 2); none is the Work's own captured draft. */
export const member = (page: { member: Immutable<z.output<ReturnType<typeof subjectSchema>>> }) =>
  page.member.kind === "ids" ? podMemberOfCode(page.member.ids[0]) : null;
/*
 * Slice 10 (MAP row 10): the family is the subject and the table's search, sort, hidden columns and
 * the save destination are route-owned query. The drawing's own pose (stage, overlay, drill,
 * inspector, the PDF pane's mode) stays in `fields`: none of it is the kernel's picture pose.
 */
export const fields = {
  member: field(subjectSchema(1), { kind: "ids", ids: [] }, "subject", "push"),
  stage: field(address.stage, "audit", "pose", "push"),
  pane: field(address.pane, "spec", "pose"),
  overlay: field(address.overlay, "draft", "pose", "push"),
  drill: field(address.drill, "", "pose", "push"),
  inspector: field(address.inspector, "", "pose"),
  doc: field(address.doc, "text", "pose"),
};
export const query = {
  // The Pod a save lands in; empty saves beside the open member.
  pod: field(address.pod, "", "query", "push"),
  query: field(address.query, "", "query"),
  sort: field(address.sort, { columns: [] }, "query"),
  hidden: field(address.hidden, {}, "query"),
};
export const loaded = read(
  hostRead(valueRead("family.workspace", familyArgs, familyData)),
  (page: Parameters<typeof member>[0]) => ({ member: member(page) }),
);
export const edits = z.array(routeStatePatchSchema);
export type FamilyContext = ContextOf<typeof fields & typeof query, typeof loaded, typeof import("@pe/agent-contracts").familyDraftRouteState, typeof edits>;
export const module = route({
  key: "family",
  name: "Family",
  needs: "host",
  optionalTarget: "document",
  host: "./host.ts",
  directory: {
    label: "Family Foundry",
    exposure: "Main",
    group: "Build / audit families",
    icon: "Boxes",
    runtimeNeed: "Revit for capture and apply",
    summary: "Inspect saved family profiles, edit cells and review PDF evidence",
    aliases: ["rfa", "author", "build", "capture", "matrix"],
    listed: true,
    satellites: [],
    resume: "document",
    surfaces: { web: "full", pwa: "full", tray: false },
  },
  subject: {
    field: "member",
    noun: "family",
    multiple: false,
    pane: "workspace",
    read: loaded,
    options: (data) =>
      data.pods.flatMap((pod) =>
        pod.members
          .filter((entry) => isSpecOf(entry.schema ?? null, FAMILY_MODEL_SCHEMA))
          .map((entry) => ({ id: podMemberCode({ pod: pod.id, path: entry.path }), label: `${pod.name} · ${entry.path}` })),
      ),
  },
  core: loaded,
  // The core read is the Goal: the doc-lab acceptance closers (`./goal.ts`).
  goal: loaded,
  fields,
  query,
  title: (ctx) => member(ctx.page.read())?.path ?? null,
  panes: {
    workspace: {
      title: "Family",
      purpose: "Review the family and its cut-sheet evidence",
      body: "scroll",
      draw: draw("scroll", () => import("./mount"), "FamilyBody"),
    },
  },
  edits: {
    work: familyDraftRouteState,
    seed: () => familyDraftRouteState.schema.parse({}),
    value: "familyWork",
    owners: {},
    input: edits,
    patches: (input) => input,
    history: z.object({ label: z.string() }),
    describe: (history) => ({ label: history.label }),
  },
  commands: {
    read: {
      ...queryAction(familyQueries["family.read"]),
      label: "Read family",
      input: ({ work }) => ({ readId: crypto.randomUUID(), expectedRevision: work!.revision }),
    },
    saved: {
      ...queryAction(familyQueries["family.saved"]),
      label: "Read saved family",
      input: (_context, supplied) => supplied,
    },
    open: {
      ...catalogAction("family.observe"),
      label: "Open member",
      // The subject names the member; the roster names the exact bytes it adopts.
      input: ({ page, value }) => {
        const ref = member(page);
        const sha256 = value?.pods.find((pod) => pod.id === ref?.pod)?.members.find((entry) => entry.path === ref?.path)?.sha256;
        return ref && sha256 ? { source: { ...ref, sha256 } } : {};
      },
    },
    attach: {
      ...sessionCommand("family.attach-spec"),
      label: "Attach PDF",
      input: (_context, supplied) => supplied,
    },
    capture: {
      ...sessionCommand("family.capture"),
      label: "Save family to pod",
    },
    build: {
      ...command("family.build"),
      label: "Build .rfa",
      present: () => ({ sentence: "Build the staged saved family member", rows: [] }),
    },
    apply: {
      ...command("family.apply"),
      label: "Apply family",
      present: (result) => presentFamilyPlan(result),
    },
  },
  layout: split("h", ["workspace", "goal"], { id: "family-main", size: 320, sized: "end" }),
});
