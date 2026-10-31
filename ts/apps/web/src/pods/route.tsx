import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { routeAddress, type SettingsRouteDocument } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { Code, JsonEditor } from "@pe/kit/lang/code";
import { EmptyState } from "@pe/kit/lang/empty";
import { List } from "@pe/kit/lang/list-popup";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { SwitchRow } from "@pe/kit/lang/switch-row";
import { Switcher } from "@pe/kit/lang/switcher";
import { mountRoute, routeFromGraph, type MountBody, type RouteAdapters } from "#/shell/mount";
import { SchemaToFieldRender } from "#/lib/schema-to-field-render";
import { schemaFormModel } from "#/settings/schema-form";
import { RunsList } from "#/route/runs-list";
import { isSpecOf } from "#/route/workflow";
import type { PodRow, Run } from "#/route/pods";
import { familyGraph, FAMILY_MODEL_SCHEMA } from "#/family/graph";
import { familiesGraph, FAMILIES_SPEC_SCHEMAS } from "#/families/graph";
import { schedulesGraph, SCHEDULE_SPEC_SCHEMA } from "#/schedules/graph";
import { podsGraph } from "./graph";
import { podsBinding, podsCell, editRefusal } from "./actions";
import { podsSources, type PluginsRead } from "./sources";
import {
  draftOf,
  readingValue,
  sameMember,
  selectedMember,
  selectedRow,
  type MemberRead,
  type CompositionRead,
} from "./model";
import type { PodsPage } from "./page";

type Body = MountBody<PodsPage, SettingsRouteDocument>;
const PRODUCTS = [
  { route: "schedules", graph: schedulesGraph, schema: SCHEDULE_SPEC_SCHEMA },
  { route: "family", graph: familyGraph, schema: FAMILY_MODEL_SCHEMA },
  { route: "families", graph: familiesGraph, schema: FAMILIES_SPEC_SCHEMAS },
] as const;
const scopeOf = ({ owner, page }: Body) => ({
  ...owner.snapshot(),
  page,
  readings: Object.fromEntries(
    Object.keys(podsGraph.readings).map((id) => [id, owner.readings.get(id)]),
  ),
});

function Members(body: Body) {
  const { owner, page, visible } = body;
  const reading = owner.readings.get("pods");
  const pods = readingValue<readonly PodRow[]>(reading) ?? [];
  const plugins = readingValue<PluginsRead>(owner.readings.get("plugins"));
  const ref = selectedMember(page);
  return (
    <>
      {!owner.fixture && (
        <div aria-label="Pod activation">
          {pods.map((pod) => {
            const plugin = plugins?.statuses.find((status) => status.id === `pod:${pod.id}`);
            const routes =
              plugins?.routes
                .filter((route) => route.packageId === pod.id)
                .map((route) => route.name) ?? [];
            const control = owner.control("activation", {
              id: `pod:${pod.id}`,
              enabled: plugin?.status !== "active",
            });
            return (
              <SwitchRow
                key={pod.id}
                label={pod.name}
                checked={plugin?.status === "active"}
                onCheckedChange={(enabled) => {
                  void owner.control("activation", { id: `pod:${pod.id}`, enabled }).run();
                }}
                disabled={!visible || owner.busy() !== null}
                refusal={control.refusal}
                says={`On: the host runs this Pod's plugin${routes.length ? ` and serves ${routes.join(", ")}` : ""}. Off: the folder stays in Pods.`}
              />
            );
          })}
        </div>
      )}
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
        failure={reading.error}
        empty={reading.status === "pending" ? "Reading installed pods…" : "No pods installed."}
        onPick={({ pod, member }) => {
          if (visible) void owner.control("select", { pod: pod.id, path: member.path }).run();
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
  const ref = selectedMember(body.page);
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
      ...(body.owner.fixture ? { fixture: Object.keys(product.graph.seeds ?? {})[0] } : {}),
      ...(body.thread && { thread: body.thread }),
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
  const buffer = useRef<string | null>(null);
  const change = (text: string) => {
    buffer.current = text;
    setTyped(text);
    body.owner.view.setPage({ pendingDraft: text !== draft });
  };
  const value = typed ?? draft;
  const form = schemaFormModel(value, schemaJson);
  const baseline = schemaFormModel(basis, schemaJson);
  const raw = !form || body.page.mode === "raw";
  const control = body.owner.control("edit", { content: value });
  const target = body.owner.snapshot().target;
  const commit = async () => {
    if (typed === null || typed === draft || refusal || !body.visible) return;
    const result = await control.run();
    if (result.state === "done" && buffer.current === typed) {
      buffer.current = null;
      setTyped(null);
      body.owner.view.setPage({ pendingDraft: false });
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
      <Switcher
        ariaLabel="editor mode"
        value={raw ? "raw" : "form"}
        onChange={(mode) => {
          void body.owner.control("mode", { mode }).run();
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
              optionsFrom={target.kind === "document" ? target.ref : null}
              onChange={setAt}
            />
          </fieldset>
        )
      )}
      {typed !== null && typed !== draft && (
        <Button
          label="Edit member"
          refusal={refusal ?? control.refusal}
          onClick={() => void commit()}
        >
          Edit member
        </Button>
      )}
    </div>
  );
}

function Spec(body: Body) {
  const scope = scopeOf(body);
  const { page } = body;
  const pods = readingValue<readonly PodRow[]>(scope.readings.pods) ?? [];
  const { member, ref } = selectedRow(page, pods);
  const memberRead = readingValue<MemberRead>(scope.readings.member);
  const read = sameMember(memberRead?.member, ref) ? memberRead : null;
  const compositionRead = readingValue<CompositionRead>(scope.readings.composition);
  const composed = sameMember(compositionRead?.member, ref) ? compositionRead : null;
  const work = scope.work?.doc;
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
      {body.owner.fixture && (
        <FactChip tone="caution" dashed title="Fixture members and runs; read-only.">
          fixture
        </FactChip>
      )}
      <FactChip title={member?.schema ?? "Plain data; no library validates it."}>
        {member?.schema?.split("/").at(-1) ?? "no $schema"}
      </FactChip>
      <FactChip
        title={
          scope.target.kind === "document"
            ? "Options come from the selected document."
            : "No document: the form offers the schema's own options only."
        }
      >
        {scope.target.kind === "document" ? "document options" : "schema options only"}
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
            <span className="face-mono">{key}</span>{" "}
            <output>{JSON.stringify(cell.edit ?? cell.suggestion)}</output>
            {body.verbs({ key })}
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

function Runs({ owner, page, visible }: Body) {
  const reading = owner.readings.get("runs");
  const pods = readingValue<readonly PodRow[]>(owner.readings.get("pods")) ?? [];
  const { member } = selectedRow(page, pods);
  const scope = page.runs === "pod" || !member ? "pod" : "member";
  const control = owner.control("runs", { runs: scope === "pod" ? "member" : "pod" });
  return (
    <>
      <Button
        label="Change run scope"
        refusal={
          !member
            ? "This draft has no member yet, so its runs belong to the whole pod."
            : !visible
              ? "This pane is hidden."
              : control.refusal
        }
        onClick={() => void control.run()}
      >
        {scope === "pod" ? "whole pod" : "this member"}
      </Button>
      <RunsList
        runs={readingValue<readonly Run[]>(reading) ?? []}
        memberSha256={member?.sha256}
        scope={scope}
        failure={reading.error}
      />
    </>
  );
}

export const podsAdapters: RouteAdapters<PodsPage, SettingsRouteDocument> = {
  lease: (owner) => ({
    context: {
      member: selectedMember(owner.view.read().page),
      work: owner.snapshot().work?.handle ?? null,
    },
    facts: {
      member: owner.readings.get("member").value ?? null,
      composition: owner.readings.get("composition").value ?? null,
    },
  }),
  sources: podsSources(),
  binding: podsBinding,
  cell: podsCell,
  verbDepends: {
    open: ["member"],
    adopt: ["member"],
    save: ["member", "composition"],
    "save-new": ["member", "composition"],
    activation: ["plugins"],
  },
  receiptPaths: (receipt) =>
    receipt.key === "settings.observe" || receipt.key === "settings.write"
      ? [["basis"], ["fields"]]
      : [],
  bodies: {
    members: (body) => <Members {...body} />,
    spec: (body) => <Spec {...body} />,
    runs: (body) => <Runs {...body} />,
  },
};
export const PodsRoute = mountRoute(podsGraph, podsAdapters);
export const podsRoute = routeFromGraph(podsGraph, podsAdapters, "/pods");
