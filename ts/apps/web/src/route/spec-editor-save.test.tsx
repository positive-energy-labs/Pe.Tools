// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { memberWork, settingsRouteState, type SettingsRouteDocument } from "@pe/agent-contracts";
import type { ReactNode } from "react";
import { SpecEditor } from "./spec-editor";

const state = vi.hoisted(() => ({
  revision: 13,
  doc: null as SettingsRouteDocument | null,
  listeners: new Set<() => void>(),
  patches: [] as unknown[],
  commands: [] as { key: string; input: Record<string, unknown> }[],
  rawWrites: 0,
}));
const member = { pod: "editor-test", path: "settings/source.json" };
const baseline = '{"width":1}';
const hash = "a".repeat(64);
vi.mock("./activity", () => ({ useRouteDemo: () => null }));
vi.mock("@pe/kit/lang/code", () => {
  return {
    Code: ({ children }: { children: ReactNode }) => <pre>{children}</pre>,
    JsonEditor: ({
      value,
      onChange,
      ...props
    }: {
      value: string;
      onChange: (value: string) => void;
    }) => (
      <textarea
        {...props}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    ),
  };
});
vi.mock("./pods", () => ({
  podHost: {
    read: async () => ({ content: '{"width":1}', sha256: "a".repeat(64) }),
    compose: async (_member: unknown, content: string) => ({
      composed: content,
      diagnostics: [],
      dependencies: [],
      schemaJson: null,
    }),
    write: async () => {
      state.rawWrites++;
      throw Error("raw create bypass");
    },
    save: async () => {
      state.rawWrites++;
      throw Error("raw save bypass");
    },
  },
}));
vi.mock("#/readings", async (original) => ({
  ...(await original<object>()),
  useHostStatusSlice: () => false,
  useInventory: () => ({ state: "ready", value: { sessions: [] } }),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (original) => ({
  ...(await original<object>()),
  runSemanticAction: async (key: string, input: Record<string, unknown>) => {
    state.commands.push({ key, input });
    return { state: "succeeded", result: {} };
  },
}));
vi.mock("./use-route", async () => {
  const React = await import("react");
  const { bindCommands } = await import("./presentation");
  return {
    useRoute: () => {
      const revision = React.useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => state.revision,
      );
      const key = {
        binding: "workspace" as const,
        route: "pods",
        target: null,
        work: memberWork({ pod: "editor-test", path: "settings/source.json" }),
      };
      return {
        busy: null,
        demo: false,
        failure: null,
        work: {
          conflict: false,
          reload: () => undefined,
          current: true,
          revision,
          doc: state.doc,
          write: async (patches: { path: string[]; value?: unknown }[]) => {
            state.patches.push(...structuredClone(patches));
            for (const patch of patches) {
              const name = patch.path[1]!;
              if (patch.value === undefined) delete state.doc!.fields[name];
              else state.doc!.fields[name] = patch.value as SettingsRouteDocument["fields"][string];
            }
            state.doc = structuredClone(state.doc);
            state.revision++;
            for (const listener of state.listeners) listener();
            return { ok: true, revision: state.revision };
          },
        },
        actions: { open: { run: async () => undefined }, adopt: { run: async () => undefined } },
        commands: bindCommands({ kind: "host" }, { key, revision }, () => {}),
      };
    },
  };
});
afterEach(() => {
  cleanup();
  state.listeners.clear();
  vi.restoreAllMocks();
});

test.each([false, true])(
  "the first clean raw edit saves reviewed Work; create destination=%s",
  async (asNew) => {
    state.revision = 13;
    state.doc = settingsRouteState.schema.parse({
      basis: { member, rawContent: baseline, sha256: hash },
      fields: {},
    });
    state.patches = [];
    state.commands = [];
    state.rawWrites = 0;
    render(<SpecEditor member={member} schema={null} optionsFrom={null} />);
    const input = await screen.findByRole("textbox", { name: "spec JSON" });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(baseline));
    const authored = '{"width":2,"exact":"typed bytes"}';
    fireEvent.change(input, { target: { value: authored } });
    const save = screen.getByRole("button", { name: asNew ? /^save as new$/ : /^save$/ });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() => expect(state.doc?.fields[""]?.edit?.value).toBe(authored));
    await waitFor(() => expect(save.getAttribute("aria-disabled")).not.toBe("true"));
    await act(async () => {
      fireEvent.click(save);
    });
    expect(state.rawWrites).toBe(0);
    expect(state.commands).toHaveLength(1);
    const sent = state.commands[0]!;
    expect(sent.key).toBe("settings.write");
    expect(sent.input.work).toMatchObject({ key: { work: memberWork(member) }, revision: 14 });
    expect(Object.keys(sent.input).sort()).toEqual(asNew ? ["destination", "work"] : ["work"]);
    if (asNew)
      expect(sent.input.destination).toMatchObject({
        pod: member.pod,
        path: expect.stringMatching(/^settings\/source\..+\.json$/),
      });
    expect(state.doc?.fields[""]?.edit?.value).toBe(authored);
  },
);

test("raw editing begins only after the host-observed member basis arrives", async () => {
  state.revision = 0;
  state.doc = settingsRouteState.schema.parse({ basis: null, fields: {} });
  state.patches = [];
  state.commands = [];
  state.rawWrites = 0;
  render(<SpecEditor member={member} schema={null} optionsFrom={null} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole("textbox", { name: "spec JSON" })).toBeNull();
  await act(async () => {
    state.doc = settingsRouteState.schema.parse({
      basis: { member, rawContent: baseline, sha256: hash },
      fields: {},
    });
    state.revision++;
    for (const listener of state.listeners) listener();
  });
  const input = await screen.findByRole("textbox", { name: "spec JSON" });
  fireEvent.change(input, { target: { value: '{"width":3}' } });
  await waitFor(() => expect(state.doc?.fields[""]?.edit?.value).toBe('{"width":3}'));
  expect(state.rawWrites).toBe(0);
});

test("reviewed field edits use the editor's single Save with their rendered Work revision", async () => {
  state.revision = 17;
  state.doc = settingsRouteState.schema.parse({
    basis: { member, rawContent: baseline, sha256: hash },
    fields: { "/width": { edit: { value: 2 } } },
  });
  state.commands = [];
  state.rawWrites = 0;
  render(<SpecEditor member={member} schema={null} optionsFrom={null} />);
  const save = screen.getByRole("button", { name: /^save$/ });
  await waitFor(() => expect(save.getAttribute("aria-disabled")).not.toBe("true"));
  await act(async () => fireEvent.click(save));
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toEqual({
    key: "settings.write",
    input: {
      work: {
        key: { binding: "workspace", route: "pods", target: null, work: memberWork(member) },
        revision: 17,
      },
    },
  });
  expect(state.rawWrites).toBe(0);
});
