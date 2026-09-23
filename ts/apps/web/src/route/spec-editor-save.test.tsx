// @vitest-environment jsdom
/**
 * One save per member: the real editor, member Work manifest and `settingsCandidate`, over an
 * in-memory Work and disk. `settings.write` is simulated the way the host settles it: splice,
 * write if the sha still matches, drop staged values, move the basis.
 */
import { useEffect, useReducer } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  settingsCandidate,
  type RouteStatePatch,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

const member = { pod: "mech", path: "settings/schedule/a.json" };
const disk = { content: "", sha256: "s0", saves: 0 };
const work = {
  doc: null as SettingsRouteDocument | null,
  revision: 0,
  listeners: new Set<() => void>(),
};
/** What the host's compose answers for any draft; a test sets it before the draft moves. */
let diagnostics: object[] = [];
const publish = () => work.listeners.forEach((listener) => listener());

const patch = (doc: SettingsRouteDocument, patches: RouteStatePatch[]) => {
  const next = structuredClone(doc) as unknown as Record<string, unknown>;
  for (const { path, value } of patches as { path: string[]; value?: unknown }[]) {
    let node = next;
    for (const key of path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>;
    if (value === undefined) delete node[path.at(-1)!];
    else node[path.at(-1)!] = value;
  }
  return next as unknown as SettingsRouteDocument;
};

vi.mock("#/readings", async (original) => ({
  ...(await original<typeof import("#/readings")>()),
  useHostStatus: () => ({ state: "absent" }),
}));

vi.mock("./pods", async (original) => ({
  ...(await original<typeof import("./pods")>()),
  podHost: {
    read: async () => ({ content: disk.content, sha256: disk.sha256 }),
    compose: async () => ({ composed: null, diagnostics, dependencies: [], schemaJson: null }),
    save: async () => {
      throw Error("a staged member must not save through pod.member.save");
    },
    write: async () => {
      throw Error("not in this test");
    },
  },
}));

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  actionResult: (value: unknown) => value,
  saveSettingsAction: async (_key: unknown, doc: SettingsRouteDocument, revision: number) => {
    if (revision !== work.revision || doc.basis!.sha256 !== disk.sha256)
      return { kind: "conflict" };
    disk.content = settingsCandidate(doc.basis!.rawContent, doc.fields);
    disk.sha256 = `s${++disk.saves}`;
    const fields = structuredClone(doc.fields);
    for (const field of Object.values(fields)) delete field.staged;
    work.doc = {
      basis: { member, rawContent: disk.content, sha256: disk.sha256 },
      fields,
    };
    work.revision += 1;
    publish();
    return { kind: "ok" };
  },
}));

type Manifest = {
  actions: Record<
    string,
    {
      ready: (ctx: unknown, input?: unknown) => string | null;
      run: (ctx: unknown, input?: unknown) => Promise<unknown>;
    }
  >;
};

vi.mock("./use-route", async (original) => ({
  ...(await original<typeof import("./use-route")>()),
  useRoute: (manifest: Manifest) => {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      work.listeners.add(rerender);
      return () => void work.listeners.delete(rerender);
    }, []);
    const ctx = {
      work: {
        key: { route: "pods", target: null, work: "w" },
        doc: work.doc,
        revision: work.revision,
      },
      write: async (patches: RouteStatePatch[]) => {
        work.doc = patch(work.doc!, patches);
        work.revision += 1;
        publish();
        return null;
      },
    };
    const actions = Object.fromEntries(
      Object.entries(manifest.actions).map(([name, action]) => [
        name,
        {
          refusal: action.ready(ctx),
          run: async (input?: unknown) => {
            try {
              await action.run(ctx, input);
              return null;
            } catch (error) {
              return { code: "conflict", message: (error as Error).message };
            }
          },
        },
      ]),
    );
    return {
      work: {
        ...ctx.work,
        current: true,
        conflict: false,
        reload: () => undefined,
        write: async (patches: RouteStatePatch[]) => {
          work.doc = patch(work.doc!, patches);
          work.revision += 1;
          publish();
          return null;
        },
      },
      actions,
      busy: null,
      failure: null,
      demo: false,
    };
  },
}));

const { SpecEditor } = await import("./spec-editor");

afterEach(cleanup);

test("a staged field and a draft edit beside a $preset save once, and both read back", async () => {
  disk.content = '{\n  "$preset": "@local/base.json",\n  "a": 1\n}\n';
  work.doc = {
    basis: { member, rawContent: disk.content, sha256: disk.sha256 },
    fields: { "/a": { proposal: null, staged: { value: 2 } } },
  };
  render(<SpecEditor member={member} schema={null} />);
  const editor = (await screen.findByRole("textbox", { name: "spec JSON" })) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.value).toBe(disk.content));

  fireEvent.change(editor, {
    target: { value: '{\n  "$preset": "@local/base.json",\n  "a": 1,\n  "b": 3\n}\n' },
  });
  // The draft lands on the Work as its root raw edit; save waits for it.
  await waitFor(() => expect(work.doc!.fields[""]?.staged?.value).toContain('"b": 3'));
  const save = screen.getByRole("button", { name: /^save$/i });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));

  await act(async () => void fireEvent.click(save));
  await waitFor(() => expect(disk.saves).toBe(1));
  expect(JSON.parse(disk.content)).toEqual({ $preset: "@local/base.json", a: 2, b: 3 });
  expect(Object.values(work.doc!.fields).some((field) => field.staged)).toBe(false);
  expect(screen.queryByText(/changed on disk|adopt/i)).toBeNull();
  await waitFor(() => expect(editor.value).toBe(disk.content));
});

test("save refuses a draft the host just called invalid, in raw mode too, and clears on a clean compose", async () => {
  disk.content = '{ "datums": {} }';
  work.doc = { basis: { member, rawContent: disk.content, sha256: disk.sha256 }, fields: {} };
  render(<SpecEditor member={member} schema={null} />);
  const editor = (await screen.findByRole("textbox", { name: "spec JSON" })) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.value).toBe(disk.content));
  const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
  const saveAsNew = screen.getByRole("button", { name: /save as new/i }) as HTMLButtonElement;

  diagnostics = [
    { code: "schema.type", message: "must be object", path: "$.datums", severity: "error" },
  ];
  fireEvent.change(editor, { target: { value: '{ "datums": "x" }' } });
  await waitFor(() =>
    expect(save.title).toBe(
      "The host called this draft invalid: 1 error, first $.datums: must be object.",
    ),
  );
  expect(save.getAttribute("aria-disabled")).toBe("true");
  expect(saveAsNew.disabled).toBe(true);
  expect(saveAsNew.title).toBe(save.title);
  const saves = disk.saves;
  fireEvent.click(save);
  expect(disk.saves).toBe(saves);

  diagnostics = [];
  fireEvent.change(editor, { target: { value: '{ "datums": { "Ref Level": {} } }' } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^save$/i }).hasAttribute("aria-disabled")).toBe(
      false,
    ),
  );
  expect((screen.getByRole("button", { name: /save as new/i }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

test("opening and adopting member bytes uses generic Work writes and preserves proposals until review", async () => {
  disk.content = '{"x":1}';
  disk.sha256 = "opened";
  work.doc = { basis: null, fields: {} };
  diagnostics = [];
  const view = render(<SpecEditor member={member} schema={null} />);
  await waitFor(() => expect(work.doc!.basis?.sha256).toBe("opened"));
  view.unmount();
  work.doc!.fields["/x"] = { proposal: { value: 2 } };
  disk.content = '{"x":3}';
  disk.sha256 = "changed";
  render(<SpecEditor member={member} schema={null} />);
  const adopt = await screen.findByRole("button", { name: "adopt disk bytes" });
  expect(work.doc!.basis!.sha256).toBe("opened");
  expect(work.doc!.fields["/x"].proposal?.value).toBe(2);
  await act(async () => void fireEvent.click(adopt));
  await waitFor(() => expect(work.doc!.basis!.sha256).toBe("changed"));
  expect(work.doc!.basis!.rawContent).toBe(disk.content);
  expect(work.doc!.fields).toEqual({});
});
