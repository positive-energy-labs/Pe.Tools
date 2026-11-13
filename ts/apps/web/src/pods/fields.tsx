import { useState } from "react";
import { z } from "zod";
import { routeAddress, settingsRouteState } from "@pe/agent-contracts";
import { podsValue, podMemberCode } from "../../../../packages/agent-contracts/src/pods-read.ts";
import { StateCell } from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { useRouteSearchSlice } from "../route/activity";
import { isSpecOf } from "../route/workflow";
import type { PodsContext } from "./route.ts";

type Value = z.output<typeof podsValue>;
const pointer = (key: string) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
const objectOf = (text: string | undefined) => {
  try { return z.record(z.string(), z.unknown()).safeParse(JSON.parse((text ?? "").replace(/^\uFEFF/, ""))).data ?? null; }
  catch { return null; }
};
const hidden = (read: Value, under?: string) => Object.entries(read.work?.fields ?? {})
  .filter(([at, cell]) => cell.edit && (under === undefined
    ? at === "" || at.indexOf("/", 1) > 0 || cell.edit.delete : at.startsWith(`${under}/`)))
  .map(([at, cell]) => at === "" ? "the whole file as raw text" : cell.edit?.delete ? `delete ${at}` : at);
export const fieldsEmpty = (raw: unknown) => {
  const read = raw === null ? null : podsValue.parse(raw);
  const ref = read?.scope;
  if (!ref?.pod || !ref.path) return "Pick a member on the left to edit its Work";
  if (!ref.path.endsWith(".json")) return `${ref.path} is source, not a JSON spec; pick a .json member`;
  if (!read?.member) return `Reading ${ref.pod} · ${ref.path}`;
  return objectOf(read.draft) ? null : "The draft is not a JSON object; Pea can repair it as raw text";
};
export const fieldsNote = (raw: unknown) => {
  const read = podsValue.parse(raw);
  const edits = read.scope.pod && read.member ? hidden(read) : [];
  return edits.length ? `Save also writes staged edits these cells do not show: ${edits.join(", ")}` : null;
};
/** The frozen binding Domain has no arbitrary JSON arm. Pod member values stay route-local,
 * over the same canonical Work cells and saved-file basis as before (BRIEF-NOTES S6). */
export function memberFields(raw: unknown, work?: unknown) {
  const read = podsValue.parse(raw);
  const doc = work === undefined ? read.work : settingsRouteState.schema.parse(work ?? {});
  const saved = objectOf(read.member?.content);
  return Object.keys((read.scope.pod && read.member && objectOf(read.draft)) || {}).map(key => {
    const row = pointer(key), edit = doc?.fields[row]?.edit, beneath = hidden(read, row);
    const model = saved?.[key] ?? null;
    return { row, label: key, model, value: edit?.value ?? model, source: edit?.value !== undefined ? "work" : "model",
      ...(read.work?.basis ? {} : { refusal: "Open saved bytes before editing: this Work has no saved basis" }),
      ...(beneath.length ? { note: `Save also writes beneath this key: ${beneath.join(", ")}` } : {}) };
  });
}
const jsonOrText = (text: string) => { try { return JSON.parse(text); } catch { return text; } };
export function MemberFields({ ctx }: { ctx: PodsContext }) {
  const [typedOnly, setTypedOnly] = useState(false);
  const search = useRouteSearchSlice(s => s);
  const read = ctx.value.value;
  const empty = fieldsEmpty(read ?? null);
  if (empty || !read) return <p className="text-ink-2">{empty}</p>;
  const cells = memberFields(read, ctx.cells.doc), note = fieldsNote(read);
  const family = read.member && isSpecOf(read.schemaRef, "/schemas/settings/FamilyFoundry/models.json")
    ? routeAddress("family").link({ stage: "apply", member: { kind: "ids", ids: [podMemberCode({ pod: read.scope.pod, path: read.scope.path })] },
      ...(typeof search.thread === "string" ? { thread: search.thread } : {}) }) : null;
  return <section aria-label="Member fields" className="flex min-w-0 flex-col gap-1 t-small">
    {family ? <a href={family} className="text-ink-2">Open in Family</a> : null}
    {note ? <p role="note" className="text-ink-2">{note}</p> : null}
    <Button kind="quiet" pressed={typedOnly} label={typedOnly ? "Show every cell" : "Show typed cells only"} onPress={() => setTypedOnly(!typedOnly)}>
      typed only ({cells.filter(c => c.source === "work").length})
    </Button>
    {!cells.length ? <p className="text-ink-2">This member has no top-level fields.</p> : null}
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-1">
      {cells.filter(c => !typedOnly || c.source === "work").map(cell => <div key={cell.row} className="contents" data-sheet-address={`fields:${cell.row}`}>
        <span>{cell.label}</span>
        <StateCell cell={ctx.cells.at(["fields", cell.row])} value={ctx.value} label={cell.label} model={cell.model} source="saved file" scale="row"
          capReason={cell.refusal} note={cell.note}
          format={value => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)}
          parse={text => typeof cell.model === "string" ? text : jsonOrText(text)} />
      </div>)}
    </div>
    {typedOnly && !cells.some(c => c.source === "work") ? <p className="text-ink-2">No typed cells; show every cell to type one.</p> : null}
  </section>;
}
