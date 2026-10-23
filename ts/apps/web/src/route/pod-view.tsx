import * as React from "react";
import * as kit from "@pe/kit";
import { z } from "zod";
import { podRouteWorkSpec, parseContributionKey, message } from "@pe/agent-contracts";
import { isAnyOperationKey } from "@pe/host-contracts/operation-types";
import { peClient } from "#/host/pe-client";
import { callHostRpc } from "#/host/client";
import { defineRoute, type Ctx } from "./manifest";
import { RouteShell, useChooseTarget } from "./shell";
import { useRoute } from "./use-route";
import { useDocumentLadder, LadderPicker } from "./situation-ladder";
import { usePublishPagePalette } from "#/navigation/route-controls";
import { KeysNode } from "@pe/kit/keys";
import type { PodRouteDescriptor } from "@pe/agent-contracts";
import { CommandPalette } from "@pe/kit/lang/list-popup";
import {
  submitAction,
  actionResult,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

type State = Record<string, unknown>;
type Work = { version: 1; state: State };
type Page = { palette: boolean };
type Event = Record<string, unknown>;
interface PodApi {
  React: typeof React;
  kit: typeof kit;
  useState(): { state: State; fire(event: Event): Promise<void> };
  getState(): State;
  target(): Promise<{ session: string; openId: string; title: string }>;
  read(key: string, input: State): Promise<unknown>;
  do(key: string, input: State): Promise<unknown>;
  exportSnapshot(snapshot: unknown): Promise<void>;
}
export interface PodRouteBundle {
  version: number;
  initial: State;
  reducer(state: State, event: Event): State;
  create(api: PodApi): React.ComponentType;
}

export async function executePodAction(
  ctx: Pick<Ctx<Work, never, Page>, "target" | "work">,
  key: string,
  input: State,
) {
  const reference = parseContributionKey(key);
  if (reference) {
    if (reference.kind !== "script") throw Error(`${key} is not an executable script.`);
    const captured = await peClient.call("contributions.read", { query: { key } });
    if (!captured.sourceBundle) throw Error(`${key} has no captured source bundle.`);
    key = "scripting.execute";
    input = {
      sourcePath: reference.path,
      sourceBundle: captured.sourceBundle,
      ...Object.fromEntries(
        ["permissionMode", "timeoutSeconds"]
          .filter((name) => input[name] !== undefined)
          .map((name) => [name, input[name]]),
      ),
    };
  } else if (!isAnyOperationKey(key)) throw Error(`Unknown operation ${key}`);
  return actionResult(
    await submitAction(
      {
        id: crypto.randomUUID(),
        kind: "operation",
        key,
        destination: ctx.target,
        input,
        bases:
          ctx.work.revision === null
            ? {}
            : { work: { key: ctx.work.key, revision: ctx.work.revision } },
      },
      "",
      120_000,
    ),
  );
}

export function makePodRoute(row: PodRouteDescriptor, bundle: PodRouteBundle) {
  if (
    bundle.version !== 1 ||
    typeof bundle.create !== "function" ||
    typeof bundle.reducer !== "function" ||
    !bundle.initial ||
    Array.isArray(bundle.initial)
  )
    throw Error("This Pod route does not implement route bundle version 1.");
  const responses = new Map<string, unknown>();
  const manifest = defineRoute<Work, never, Page, "execute">({
    key: row.workRoute,
    name: row.name,
    needs: "document",
    work: podRouteWorkSpec(row.workRoute, row.name),
    page: z.object({ palette: z.boolean().default(false) }),
    docs: row.description,
    actions: {
      execute: {
        label: "Run Pod action",
        visible: false,
        input: z.custom<never>(
          (raw) =>
            z
              .object({ id: z.string(), key: z.string(), input: z.record(z.string(), z.unknown()) })
              .safeParse(raw).success,
        ),
        says: "Execute the requested Pod action on this route's exact target.",
        needs: "document",
        actor: "human",
        dirties: [],
        requires: { work: true },
        ready: () => null,
        run: async (ctx, raw) => {
          const input = raw as { id: string; key: string; input: State };
          responses.set(input.id, await executePodAction(ctx, input.key, input.input));
        },
      },
    },
  });
  function View({ thread }: { thread: string }) {
    const [chosen] = useChooseTarget();
    const handle = useRoute(manifest, {
      target: chosen,
      thread,
      url: false,
      work: (_page, target) => (target === null ? "calculator" : undefined),
    });
    const latest = React.useRef(handle);
    latest.current = handle;
    const queue = React.useRef(Promise.resolve());
    const queued = React.useRef<{ state: State; revision: number; key: string } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [targetPalette, setTargetPalette] = React.useState(false);
    const initializing = React.useRef<string | null>(null);
    const active = React.useRef(true);
    React.useEffect(() => {
      active.current = true;
      return () => {
        active.current = false;
      };
    }, []);
    const ladder = useDocumentLadder(handle);
    const targetTitle = React.useRef(ladder.docWord);
    targetTitle.current = ladder.docWord;
    const [page, setPage] = handle.page;
    usePublishPagePalette(row.workRoute, page.palette, (palette) => setPage({ palette }));
    React.useEffect(() => {
      const key = JSON.stringify(handle.work.key);
      if (queued.current?.key !== key) queued.current = null;
      if (
        handle.work.current &&
        !handle.work.refusal &&
        initializing.current !== key &&
        (!handle.work.doc || Object.keys(handle.work.doc.state).length === 0)
      ) {
        initializing.current = key;
        void handle.work.write([{ path: ["state"], value: bundle.initial }]).then((failure) => {
          if (failure) {
            initializing.current = null;
            setError(failure.message);
          }
        });
      }
    }, [handle.work.key, handle.work.current, handle.work.doc, handle.work.refusal]);
    const api: PodApi = React.useMemo<PodApi>(
      () => ({
        React,
        kit,
        useState: () => ({
          state: latest.current.work.doc?.state ?? bundle.initial,
          fire: (event) => {
            const expectedKey = JSON.stringify(latest.current.work.key);
            const run = queue.current.then(async () => {
              const h = latest.current;
              if (!active.current || JSON.stringify(h.work.key) !== expectedKey)
                throw Error("This route's Work changed before the edit; choose it again.");
              if (!h.work.current || h.work.refusal)
                throw Error(h.work.refusal ?? "Work is not current.");
              const identity = JSON.stringify(h.work.key);
              const prior = queued.current?.key === identity ? queued.current : null;
              const next = bundle.reducer(
                prior?.state ?? h.work.doc?.state ?? bundle.initial,
                event,
              );
              const revision = prior?.revision ?? h.work.revision ?? 0;
              const refused = await h.work.write([{ path: ["state"], value: next }], revision);
              if (refused) {
                queued.current = null;
                throw Error(refused.message);
              }
              queued.current = { state: next, revision: revision + 1, key: identity };
            });
            queue.current = run.catch((cause: unknown) => {
              setError(message(cause));
            });
            return run;
          },
        }),
        getState: () =>
          queued.current?.key === JSON.stringify(latest.current.work.key) &&
          queued.current.revision >= (latest.current.work.revision ?? 0)
            ? queued.current.state
            : (latest.current.work.doc?.state ?? bundle.initial),
        target: async () => {
          const h = latest.current;
          if (
            h.bindingLost ||
            h.resolution.kind !== "resolved" ||
            h.resolution.target.kind !== "document"
          )
            throw Error(
              h.bindingLost?.sentence ?? "Choose an exact document in this route's palette.",
            );
          return { ...h.resolution.target.ref, title: targetTitle.current ?? "" };
        },
        read: async (key, input) => {
          if (!isAnyOperationKey(key)) throw Error(`Unknown operation ${key}`);
          const target = await api.target();
          return callHostRpc(key, input as never, {
            bridgeSessionId: target.session,
            openDocumentId: target.openId,
          });
        },
        do: async (key, input) => {
          await queue.current;
          const id = crypto.randomUUID();
          const refused = await latest.current.actions.execute.run({ id, key, input });
          if (refused) throw Error(refused.message);
          const response = responses.get(id);
          responses.delete(id);
          return response;
        },
        exportSnapshot: async (snapshot) => {
          if (!row.page) throw Error("This route declares no portable Page.");
          const slug = `${row.packageId.replace(/^@/, "")}--${row.page.replace(/^pages\//, "")}`;
          const response = await peClient.response("page.export", {
            params: { slug },
            body: { snapshot },
          });
          if (!response.ok) throw Error(`Page export refused (${response.status}).`);
          const url = URL.createObjectURL(await response.blob());
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${slug}.html`;
          anchor.click();
          URL.revokeObjectURL(url);
        },
      }),
      [],
    );
    const Instrument = React.useMemo(() => bundle.create(api), [api]);
    const commands = [
      { key: "target", label: "Choose document", run: () => setTargetPalette(true) },
      {
        key: "reset",
        label: "Reset authored state",
        run: () => {
          void handle.work.write([{ path: ["state"], value: bundle.initial }]).then((failure) => {
            if (failure) setError(failure.message);
            else queued.current = null;
          });
        },
      },
      { key: "reload", label: "Reload saved Work", run: handle.work.reload },
      {
        key: "export",
        label: "Export portable Page",
        run: () => {
          void api
            .exportSnapshot(api.getState())
            .catch((cause: unknown) => setError(String(cause)));
        },
      },
    ];
    return (
      <RouteShell
        manifest={manifest}
        handle={handle}
        aside={
          <LadderPicker ladder={ladder} open={targetPalette} onOpenChange={setTargetPalette} />
        }
      >
        <KeysNode
          id={`${row.name} target`}
          keys={[
            {
              hotkey: "Mod+K",
              label: "Route commands",
              callback: () => setPage({ palette: true }),
            },
          ]}
        >
          <CommandPalette
            open={page.palette}
            onOpenChange={(palette) => setPage({ palette })}
            items={commands}
            keyOf={(item) => item.key}
            labelOf={(item) => item.label}
            filter="substring"
            empty="No route commands"
            aria-label={`${row.name} commands`}
            row={(item) => ({ label: item.label })}
            onPick={(item) => item.run()}
          />
          {error && (
            <p role="alert" data-tone="alarm" className="p-3">
              {error}
            </p>
          )}
          {handle.work.refusal ? (
            <p role="alert" className="p-3">
              {handle.work.refusal}
            </p>
          ) : !handle.work.current ||
            !handle.work.doc ||
            !Object.keys(handle.work.doc.state).length ? (
            <p className="p-3">Reading route Work…</p>
          ) : (
            <Instrument />
          )}
        </KeysNode>
      </RouteShell>
    );
  }
  return {
    manifest,
    hosted: View,
  };
}
