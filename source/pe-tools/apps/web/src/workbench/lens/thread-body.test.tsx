// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import { Effect } from "effect";
import { Pane } from "#/components/lang/pane";
import { emptyChatState, type ThreadBody as ThreadWire } from "../chat-state";

vi.mock("./view", () => ({ Lens: () => <div>thread transcript</div> }));

import { ThreadBody } from "./thread-body";

afterEach(cleanup);

test("a loading thread body leaves the sidebar and composer mounted", async () => {
  const body = (): ThreadWire => {
    const { display: _display, ...wire } = emptyChatState();
    return wire;
  };
  let resolve!: (state: ThreadWire) => void;
  const bodyAtom = Atom.make(
    Effect.promise(() => new Promise<ThreadWire>((done) => (resolve = done))),
  );
  render(
    <>
      <aside>thread sidebar</aside>
      <Pane kind="content" id="transcript" title="thread">
        <ThreadBody bodyAtom={bodyAtom} state={emptyChatState()} mode="threads" sideOpen />
      </Pane>
      <footer>composer</footer>
    </>,
  );
  expect(screen.getByText("thread sidebar")).toBeTruthy();
  expect(screen.getByText("composer")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("loading thread");

  resolve(body());
  expect(await screen.findByText("thread transcript")).toBeTruthy();
  expect(screen.getByText("thread sidebar")).toBeTruthy();
  expect(screen.getByText("composer")).toBeTruthy();
});
