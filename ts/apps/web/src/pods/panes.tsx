import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeAddress, settingsRouteState } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { Code, JsonEditor } from "@pe/kit/lang/code";
import { EmptyState } from "@pe/kit/lang/empty";
import { List } from "@pe/kit/lang/list-popup";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Switcher } from "@pe/kit/lang/switcher";
import type { PaneContext } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { podsData, podsSchemas, podsEntries } from "./neutral";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { schemaFormModel } from "#/settings/schema-form";
import { RunsList } from "#/route/runs-list";
import { isSpecOf } from "#/route/workflow";
import type { PodRow, Run } from "#/route/pods";
import { familyGraph, FAMILY_MODEL_SCHEMA } from "#/family/graph";
import { editRefusal, type PodsScope } from "./actions";
import {
  draftOf,
  readingValue,
  sameMember,
  selectedMember,
  selectedRow,
  type MemberRead,
  type CompositionRead,
} from "./model";

export type Body<P extends keyof typeof podsData.panes = "spec"> = PaneContext<
  typeof podsData,
  typeof podsSchemas,
  typeof podsEntries,
  P
>;
const PRODUCTS = [{ route: "family", graph: familyGraph, schema: FAMILY_MODEL_SCHEMA }] as const;
const pageOf = (body: Pick<Body, "page">) => body.page.read();
const fixtureOf = (body: Pick<Body, "fixture">) => body.fixture !== null;
const scopeOf = (body: Body): PodsScope => ({
  page: pageOf(body),
  work: body.work ? settingsRouteState.schema.parse(body.work) : null,
  workKey: body.workBasis?.token.scope.identity.work ?? null,
  readings: body.readings,
});

export function Members(body: Body<"members">) {
  const { visible } = body;
  const page = pageOf(body);
  const reading = body.readings.pods;
  const pods = readingValue<readonly PodRow[]>(reading) ?? [];
  const ref = selectedMember(page);
  return (
    <>
      <a href={fixtureOf(body) ? "/pod-admin?fixture=inventory" : "/pod-admin"}>
        Manage Pod installation and trust
      </a>
      {pods
        .filter((pod) => pod.diagnostics.length)
        .map((pod) => (
          <OutcomeLine
            key={pod.id}
            kind="error"
            label={pod.name}
            says={pod.diagnostics.map((d) => d.message).join("; ")}
          />
        ))}
      <List
        aria-label="pod members"
        items={pods.flatMap((pod) => pod.members.map((member) => ({ pod, member })))}
        keyOf={({ pod, member }) => `${pod.id}|${member.path}`}
        labelOf={({ member }) => member.path}
        groupOf={({ pod }) => `${pod.name} · ${pod.version}`}
        filter="substring"
        searchPlaceholder="Filter members…"
        failure={!reading.current ? reading.reason : undefined}
        empty={reading.status === "pending" ? "Reading installed pods…" : "No pods installed."}
        onPick={({ pod, member }) => {
          if (visible) body.verbs.select({ pod: pod.id, path: member.path });
        }}
        row={({ pod, member }) => ({
          label: member.path,
          active: ref?.pod === pod.id && ref.path === member.path,
          meta: member.schema
            ?.split("/")
            .at(-1)
            ?.replace(/\.json$/, ""),
          title: member.schema ?? "no $schema: plain data",
        })}
      />
    </>
  );
}

/** Links resolve through the root so thread and target carry survive ordinary and modified clicks. */
function ProductLink({ body, schema }: { body: Body; schema: string | null | undefined }) {
  const router = useRouter();
  const thread = router.state.location.search.thread;
  const ref = selectedMember(pageOf(body));
  const product = PRODUCTS.find((product) => isSpecOf(schema ?? null, product.schema));
  if (!ref || !product) return null;
  const url = new URL(
    routeAddress(product.route).link({
      stage: "apply",
      ...ref,
    }),
    "http://pe.invalid",
  );
  const destination = {
    to: url.pathname,
    search: {
      ...Object.fromEntries(url.searchParams),
      ...(fixtureOf(body) ? { fixture: Object.keys(product.graph.seeds ?? {})[0] } : {}),
      ...(typeof thread === "string" && thread ? { thread } : {}),
    },
  };
  return (
    <a
      href={router.buildLocation(destination).href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        void router.navigate(destination);
      }}
    >
      open in {product.graph.name}
    </a>
  );
}

function DraftInput({
  body,
  draft,
  schemaJson,
  basis,
  issues,
  refusal,
}: {
  body: Body;
  draft: string;
  schemaJson: string | null;
  basis: string;
  issues: CompositionRead["result"]["diagnostics"];
  refusal: string | null;
}) {
  // Typing is an editor buffer; only the named kernel verb writes the shared Work.
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const buffer = useRef<string | null>(null);
  const change = (text: string) => {
    setProblem(null);
    buffer.current = text;
    setTyped(text);
    body.page.transient("pendingDraft", text !== draft);
  };
  const value = typed ?? draft;
  const form = schemaFormModel(value, schemaJson);
  const baseline = schemaFormModel(basis, schemaJson);
  const raw = !form || pageOf(body).mode === "raw";
  const target = body.workBasis?.token.scope.identity.target;
  const commit = async () => {
    if (typed === null || typed === draft || refusal || !body.visible) return;
    if (!body.workBasis) return;
    try {
      const result = await new Promise<
        import("../../../../packages/agent-contracts/src/work-journal-door").WorkWriteOutcome
      >((resolve) => {
        body.verbs.edit({ content: value }, body.workBasis!).subscribe(
          (outcome) => {
            if (outcome.kind !== "pending") resolve(outcome);
          },
          () => {},
        );
      });
      if (result.kind === "accepted" && buffer.current === typed) {
        buffer.current = null;
        setTyped(null);
        body.page.transient("pendingDraft", false);
      } else if (result.kind !== "accepted")
        setProblem("The edit was refused; read the current Work before editing again.");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    if (typed === null || typed === draft || refusal || !body.visible) return;
    const timer = setTimeout(() => void commit(), 400);
    return () => clearTimeout(timer);
    // The bound control seals this buffer's Work revision; a concurrent edit refuses it.
  }, [typed, body.visible, refusal]); // eslint-disable-line react-hooks/exhaustive-deps
  const setAt = (path: string, nextValue: unknown) => {
    const next = structuredClone(form!.parsedRaw);
    const keys = path.split(".");
    let node = next;
    for (const key of keys.slice(0, -1)) {
      if (node[key] == null || typeof node[key] !== "object") node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[keys.at(-1)!] = nextValue;
    change(JSON.stringify(next, null, 2));
  };
  return (
    <div>
      {problem && <OutcomeLine kind="error" label="member edit" says={problem} />}
      <Switcher
        ariaLabel="editor mode"
        value={raw ? "raw" : "form"}
        onChange={(mode) => {
          body.verbs.mode({ mode });
        }}
        options={[
          { value: "form", label: "form", title: "Edit through the schema form.", disabled: !form },
          { value: "raw", label: "raw", title: "Edit the JSON text." },
        ]}
      />
      {raw ? (
        <JsonEditor
          aria-label="spec JSON"
          value={value}
          onChange={change}
          readOnly={!!refusal || !body.visible}
        />
      ) : (
        form &&
        baseline && (
          <fieldset disabled={!!refusal || !body.visible}>
            <SchemaToFieldRender
              schema={form.schema}
              baselineValues={baseline.baseline}
              values={form.parsedRaw}
              issues={[...issues]}
              optionsFrom={target?.kind === "document" ? target.ref : null}
              onChange={setAt}
            />
          </fieldset>
        )
      )}
      {typed !== null && typed !== draft && (
        <Button label="Edit member" refusal={refusal} onClick={() => void commit()}>
          Edit member
        </Button>
      )}
    </div>
  );
}

export function Spec(body: Body) {
  const scope = scopeOf(body);
  const page = pageOf(body);
  const pods = readingValue<readonly PodRow[]>(scope.readings.pods) ?? [];
  const { member, ref } = selectedRow(page, pods);
  const memberRead = readingValue<MemberRead>(scope.readings.member);
  const read = sameMember(memberRead?.member, ref) ? memberRead : null;
  const compositionRead = readingValue<CompositionRead>(scope.readings.composition);
  const composed = sameMember(compositionRead?.member, ref) ? compositionRead : null;
  const work = scope.work ? settingsRouteState.schema.parse(scope.work) : null;
  let draft = "";
  let failure: string | null = null;
  try {
    draft = draftOf({ page, work: work ?? null }, read);
  } catch (error) {
    failure = String(error);
    const raw = work?.fields[""]?.edit?.value;
    draft = typeof raw === "string" ? raw : (work?.basis?.rawContent ?? read?.content ?? "");
  }
  const fields = work?.fields ?? {};
  const schema = composed?.result.schemaJson ?? read?.schemaJson ?? null;
  const issues = composed?.draft === draft ? composed.result.diagnostics : [];
  if (!ref)
    return (
      <EmptyState story="scope" exit="capture a spec, or pick a member">
        no spec open
      </EmptyState>
    );
  if (!ref.path.endsWith(".json"))
    return (
      <EmptyState story="scope" exit="pick a JSON member to edit it">
        {ref.path} is source, not a spec
      </EmptyState>
    );
  return (
    <>
      <span className="face-mono">
        {ref.pod} · {ref.path}
      </span>{" "}
      <ProductLink body={body} schema={member?.schema} />
      {fixtureOf(body) && (
        <FactChip tone="caution" dashed title="Fixture members and runs; read-only.">
          fixture
        </FactChip>
      )}
      <FactChip title={member?.schema ?? "Plain data; no library validates it."}>
        {member?.schema?.split("/").at(-1) ?? "no $schema"}
      </FactChip>
      <FactChip
        title={
          body.workBasis?.token.scope.identity.target?.kind === "document"
            ? "Options come from the selected document."
            : "No document: the form offers the schema's own options only."
        }
      >
        {body.workBasis?.token.scope.identity.target?.kind === "document"
          ? "document options"
          : "schema options only"}
      </FactChip>
      <FactChip title="Composition and semantic validation are reported by the host.">
        {composed?.result.semanticValidation === "passed" ||
        composed?.result.semanticValidation === "failed"
          ? "semantic"
          : "schema only"}
      </FactChip>
      {Object.entries(fields)
        .filter(([key]) => key !== "")
        .map(([key, cell]) => (
          <div key={key} role="group" aria-label={`Field ${key}`}>
            <span className="face-mono">{key}</span> <output>{JSON.stringify(cell.edit)}</output>
            <Button
              label="Clear field edit"
              refusal={editRefusal(scope)}
              onClick={() => body.cells.clear("fields", key)}
            >
              Clear
            </Button>
          </div>
        ))}
      {read ? (
        <DraftInput
          key={`${ref.pod}|${ref.path}|${work?.basis?.sha256 ?? ""}`}
          body={body}
          draft={draft}
          basis={work?.basis?.rawContent ?? read.content}
          schemaJson={schema}
          issues={issues}
          refusal={editRefusal(scope)}
        />
      ) : (
        <OutcomeLine kind="busy" label="reading member" />
      )}
      {failure && <OutcomeLine kind="error" label="draft" says={failure} />}
      {issues.map((issue, i) => (
        <OutcomeLine
          key={i}
          kind={issue.severity === "error" ? "error" : "advisory"}
          label={issue.path}
          says={issue.message}
        />
      ))}
      {composed?.result.composed && (
        <Code code={composed.result.composed} lang="json" title="composed" />
      )}
    </>
  );
}

export function Runs(body: Body<"runs">) {
  const { visible } = body;
  const page = pageOf(body);
  const reading = body.readings.runs;
  const pods = readingValue<readonly PodRow[]>(body.readings.pods) ?? [];
  const { member } = selectedRow(page, pods);
  const scope = page.runs === "pod" || !member ? "pod" : "member";

  return (
    <>
      <Button
        label="Change run scope"
        refusal={
          !member
            ? "This draft has no member yet, so its runs belong to the whole pod."
            : !visible
              ? "This pane is hidden."
              : null
        }
        onClick={() => body.verbs.runs({ runs: scope === "pod" ? "member" : "pod" })}
      >
        {scope === "pod" ? "whole pod" : "this member"}
      </Button>
      <RunsList
        runs={readingValue<readonly Run[]>(reading) ?? []}
        memberSha256={member?.sha256}
        scope={scope}
        failure={!reading.current ? reading.reason : undefined}
      />
    </>
  );
}
