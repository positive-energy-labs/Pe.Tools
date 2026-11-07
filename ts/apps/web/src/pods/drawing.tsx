import { podRouteSkeleton } from "../route/pod-skeleton";
import { Input } from "@pe/kit/lang/input";
import { useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeAddress } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Code, JsonEditor } from "@pe/kit/lang/code";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Switcher } from "@pe/kit/lang/switcher";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { schemaFormModel } from "#/settings/schema-form";
import { isSpecOf } from "#/route/workflow";
import { member, type PodsContext, type PodsRosterContext } from "./route.ts";
import { runRow } from "./run-row.tsx";

export function Members({ ctx }: { ctx: PodsRosterContext }) {
  const page = ctx.page.read(),
    value = ctx.value;
  const list = useList({
    value,
    rowsOf: (data) => data.pods.flatMap((pod) => pod.members.map((entry) => ({ pod, entry }))),
    keyOf: ({ pod, entry }) => `${pod.id}|${entry.path}`,
    search: ({ pod, entry }) => ({ text: [pod.name, entry.path] }),
    groups: { of: ({ pod }) => `${pod.name} · ${pod.version}` },
    onPick: ({ pod, entry }) => ctx.page.query({ pod: pod.id, path: entry.path }),
  });
  return (
    <>
      <RouteSource packageId={page.pod}/>
      {value.value?.pods.flatMap((pod) =>
        pod.diagnostics.map((diagnostic, i) => (
          <p key={`${pod.id}:${i}`} role="alert">
            {pod.name}: {diagnostic.message}
          </p>
        )),
      )}
      <ListView
        aria-label="pod members"
        list={list}
        search="always"
        empty={{ message: "No Pod members", exit: "install or enable a Pod in Pod administration" }}
        row={({ pod, entry }) => ({
          label: entry.path,
          active: page.pod === pod.id && page.path === entry.path,
          meta: entry.schema?.split("/").at(-1),
        })}
      />
    </>
  );
}
export function Spec({ ctx }: { ctx: PodsContext }) {
  const page = ctx.page.read(),
    ref = member(page),
    data = ctx.value.value;
  const router = useRouter();
  if (!ref) return <p>Pick a JSON member to inspect or edit it.</p>;
  if (!ref.path.endsWith(".json")) return <p>{ref.path} is source, not a JSON spec.</p>;
  if (data?.scope.pod !== ref.pod || data?.scope.path !== ref.path)
    return (
      <p role="status">
        Reading {ref.pod} · {ref.path}. {ctx.value.current ? "" : ctx.value.reason}
      </p>
    );
  const schema = data?.composition?.result.schemaJson ?? data?.member?.schemaJson ?? null;
  const thread = router.state.location.search.thread;
  return (
    <>
      <span className="face-mono">
        {ref.pod} · {ref.path}
      </span>
      {isSpecOf(data?.schemaRef, "/schemas/settings/FamilyFoundry/models.json") && (
        <a
          href={routeAddress("family").link({
            stage: "apply",
            ...ref,
            ...(thread ? { thread } : {}),
          })}
        >
          Open in Family
        </a>
      )}
      {!ctx.value.current && <p role="status">{ctx.value.reason}</p>}
      {data?.member && (
        <Editor
          key={`${page.pod}|${page.path}|${ctx.cells.doc?.basis?.sha256 ?? ""}`}
          ctx={ctx}
          schema={schema}
        />
      )}
      {data?.composition?.result.diagnostics.map((issue, i) => (
        <p key={i} role="status">
          {issue.path}: {issue.message}
        </p>
      ))}
      {data?.composition?.result.composed && (
        <Code code={data.composition.result.composed} lang="json" title="composed" />
      )}
    </>
  );
}
function Editor({ ctx, schema }: { ctx: PodsContext; schema: string | null }) {
  const data = ctx.value.value!,
    draft = data.draft,
    cell = ctx.cells.at(["fields", ""]);
  const [typed, setTyped] = useState<string | null>(null),
    [problem, setProblem] = useState<string | null>(null);
  const draftCell = useRef<typeof cell | null>(null);
  const change = (text: string) => {
    if (typed === null) draftCell.current = cell;
    setTyped(text);
  };
  const value = typed ?? draft,
    form = schemaFormModel(value, schema),
    baseline = schemaFormModel(ctx.cells.doc?.basis?.rawContent ?? data.member!.content, schema);
  const raw = !form || ctx.page.read().mode === "raw";
  const commit = async () => {
    if (typed === null) return;
    const text = typed;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error("A spec is a JSON object");
    } catch (error) {
      setProblem(String(error));
      return;
    }
    const bound = draftCell.current ?? cell;
    const result =
      text === ctx.cells.doc?.basis?.rawContent
        ? await bound.clear({ label: "Restore saved member" })
        : await bound.stage(text, { label: "Edit member" });
    setProblem(result?.message ?? null);
    if (!result) {
      draftCell.current = null;
      setTyped((current) => (current === text ? null : current));
    }
  };
  return (
    <>
      <Switcher
        ariaLabel="editor mode"
        value={raw ? "raw" : "form"}
        onChange={(mode) => ctx.page.pose({ mode })}
        options={[
          { value: "form", label: "form", title: "Edit through the schema form", disabled: !form },
          { value: "raw", label: "raw", title: "Edit the saved JSON text" },
        ]}
      />
      {raw ? (
        <JsonEditor
          aria-label="spec JSON"
          value={value}
          onChange={change}
          readOnly={!!cell.refusal}
        />
      ) : (
        form &&
        baseline && (
          <fieldset disabled={!!cell.refusal}>
            <SchemaToFieldRender
              schema={form.schema}
              values={form.parsedRaw}
              baselineValues={baseline.baseline}
              issues={[...(data.composition?.result.diagnostics ?? [])]}
              optionsFrom={null}
              onChange={(path, nextValue) => {
                const next = structuredClone(form.parsedRaw),
                  keys = path.split(".");
                let node = next;
                for (const key of keys.slice(0, -1)) {
                  if (!node[key] || typeof node[key] !== "object") node[key] = {};
                  node = node[key] as Record<string, unknown>;
                }
                node[keys.at(-1)!] = nextValue;
                change(JSON.stringify(next, null, 2));
              }}
            />
          </fieldset>
        )
      )}
      <Button
        label="Edit member"
        refusal={cell.refusal ?? (typed === null || typed === draft ? "No draft changes" : null)}
        onClick={commit}
      >
        Stage edit
      </Button>
      {typed !== null && (
        <Button
          label="Discard local draft"
          onClick={() => {
            draftCell.current = null;
            setTyped(null);
            setProblem(null);
          }}
        >
          Discard local draft
        </Button>
      )}
      {problem && <p role="alert">{problem}</p>}
    </>
  );
}
export function Runs({ ctx }: { ctx: PodsContext }) {
  const page = ctx.page.read();
  const list = useList({
    value: ctx.value,
    rowsOf: (data) =>
      data.scope.pod === page.pod && data.scope.path === page.path && data.scope.runs === page.runs
        ? data.runs
        : [],
    keyOf: (run) => run.runId,
    search: (run) => ({ text: [run.runId, run.receipt?.operation, run.receipt?.outcome] }),
    scope: `${page.pod}|${page.path}|${page.runs}`,
  });
  return (
    <>
      <Button
        label="Change run scope"
        onClick={() => ctx.page.query({ runs: page.runs === "pod" ? "member" : "pod" })}
      >
        {page.runs === "pod" ? "whole pod" : "this member"}
      </Button>
      <ListView
        list={list}
        aria-label={page.runs === "pod" ? "the pod's runs" : "this member's runs"}
        empty={{
          message: page.runs === "pod" ? "no runs in this pod" : "no runs for this member",
          exit: "apply a spec or draft from its product route",
        }}
        row={(run) => runRow(run, page.runs, ctx.value.value?.member?.sha256)}
      />
    </>
  );
}

/** Source for a typed tool, handed to the same publisher as builtin route modules. */
function RouteSource({packageId}:{packageId:string}) {
  const [slug,setSlug]=useState("worksheet");
  let source="",problem:string|null=null;
  try {source=podRouteSkeleton(packageId,slug);} catch(error){problem=String(error);}
  return <details><summary>New typed tool</summary>
    <label>Route slug<Input aria-label="Route slug" value={slug} onChange={event=>setSlug(event.target.value)}/></label>
    {problem?<p role="status">{packageId?problem:"Choose a Pod to generate its typed tool source"}</p>:<>
      <Code code={source} lang="typescript" title="route.ts"/>
      <a download="route.ts" href={`data:text/plain;charset=utf-8,${encodeURIComponent(source)}`}>Download route.ts</a>
    </>}
  </details>;
}
