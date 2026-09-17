// @vitest-environment jsdom
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("#/route", async () => {
  const route = await import("#/route/use-route");
  return { createRouteOwner: route.createRouteOwner, useRouteOwner: route.useRouteOwner };
});

vi.mock("./composer", () => ({
  ThreadComposer: ({ initialDraft }: { initialDraft?: { text: string } }) => {
    const [draft, setDraft] = useState(initialDraft?.text ?? "");
    return (
      <textarea
        aria-label="draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

import { ComposerBank } from "./composer-bank";
import { CurrentThreadViewOwner } from "#/workbench/thread-view";

afterEach(cleanup);

test("current view resets without evicting A, B, or a new unsent X composer", () => {
  const registry = AtomRegistry.make();
  function Shell() {
    const [thread, setThread] = useState("a");
    return (
      <>
        {["a", "b", "x"].map((id) => (
          <button key={id} type="button" onClick={() => setThread(id)}>
            {id}
          </button>
        ))}
        <CurrentThreadViewOwner
          threadKey={thread}
          registry={registry}
          patch={async () => undefined}
        >
          <ComposerBank
            currentThreadId={thread}
            deletedThreadIds={new Set()}
            prompt={thread === "x" ? "new X" : undefined}
            handle={{} as never}
            topBar={null}
          />
        </CurrentThreadViewOwner>
      </>
    );
  }

  render(<Shell />);
  const draft = () => screen.getByRole("textbox", { name: "draft" }) as HTMLTextAreaElement;
  fireEvent.change(draft(), { target: { value: "draft A" } });
  fireEvent.click(screen.getByRole("button", { name: "x" }));
  expect(draft().value).toBe("new X");
  fireEvent.change(draft(), { target: { value: "draft X" } });
  fireEvent.click(screen.getByRole("button", { name: "b" }));
  fireEvent.change(draft(), { target: { value: "draft B" } });
  fireEvent.click(screen.getByRole("button", { name: "a" }));
  expect(draft().value).toBe("draft A");
  fireEvent.click(screen.getByRole("button", { name: "x" }));
  expect(draft().value).toBe("draft X");
});
