import { podRouteFiles } from "../route/pod-skeleton";
import { podRoutePath } from "../route/pod-address";
import { Input } from "@pe/kit/lang/input";
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Code } from "@pe/kit/lang/code";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { podMemberCode } from "@pe/agent-contracts";
import { useAdmittedSubject } from "#/shell/subject";
import { member, type PodsContext, type PodsRosterContext } from "./route.ts";
import { runRow } from "./run-row.tsx";
import { podDiagnostic } from "../route/readable-refusal";

export function Members({ ctx }: { ctx: PodsRosterContext }) {
  const open = member(ctx.page.read()),
    value = ctx.value,
    subject = useAdmittedSubject();
  const list = useList({
    value,
    rowsOf: (data) => data.pods.flatMap((pod) => pod.members.map((entry) => ({ pod, entry }))),
    keyOf: ({ pod, entry }) => `${pod.id}|${entry.path}`,
    search: ({ pod, entry }) => ({ text: [pod.name, entry.path] }),
    groups: { of: ({ pod }) => `${pod.name} · ${pod.version}` },
    // The roster is the subject list (ADR 0035 rule 1): a pick opens that one member.
    onPick: ({ pod, entry }) => subject?.select([podMemberCode({ pod: pod.id, path: entry.path })]),
  });
  return (
    <>
      {value.value?.pods.flatMap((pod) =>
        pod.contributions.filter((entry) => entry.kind === "route").map((entry) => (
          <a key={entry.key} href={podRoutePath(entry.key)}>Manage trust for {entry.name}</a>
        )),
      )}
      <RouteSource packageId={open?.pod ?? ""}/>
      {value.value?.pods.flatMap((pod) =>
        pod.diagnostics.map((diagnostic, i) => (
          <p key={`${pod.id}:${i}`} role="alert">
            {pod.name}: {podDiagnostic(diagnostic)}
          </p>
        )),
      )}
      <ListView
        aria-label="pod members"
        list={list}
        search="always"
        empty={{ message: "No Pod members", exit: "Ask Pea to import a Pod .zip with pod.import" }}
        row={({ pod, entry }) => ({
          label: entry.path,
          active: open?.pod === pod.id && open.path === entry.path,
          meta: entry.schema?.split("/").at(-1),
        })}
      />
    </>
  );
}
export function Runs({ ctx }: { ctx: PodsContext }) {
  const read = ctx.page.read(),
    page = { pod: member(read)?.pod ?? "", path: member(read)?.path ?? "", runs: read.runs };
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
  let files:ReturnType<typeof podRouteFiles>|null=null,problem:string|null=null;
  try {files=podRouteFiles(packageId,slug);} catch(error){problem=String(error);}
  return <details><summary>New typed tool</summary>
    <label>Route slug<Input aria-label="Route slug" value={slug} onChange={event=>setSlug(event.target.value)}/></label>
    {problem?<p role="status">{packageId?problem:"Choose a Pod to generate its typed tool source"}</p>:<>
      {Object.entries(files??{}).map(([name,source])=><div key={name}>
        <Code code={source} lang="typescript" title={name}/>
        <a download={name} href={`data:text/plain;charset=utf-8,${encodeURIComponent(source)}`}>Download {name}</a>
      </div>)}
    </>}
  </details>;
}


