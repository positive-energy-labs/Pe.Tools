// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { address, type Scope } from "@pe/agent-contracts";
import { ScopeHead, scopeDocuments, type ScopeSessionOption } from "./scope-head";

afterEach(cleanup);

const projectA = address("C:\\Fixtures\\project-a Residence.rvt");
const door = address("C:\\Fixtures\\Door-Single.rfa");
const one: ScopeSessionOption = {
  id: "pe.app-25",
  label: "pe.app-25",
  document: projectA,
  documentLabel: "project-a Residence.rvt",
};
const two: ScopeSessionOption = { ...one, id: "pe.app-26", label: "pe.app-26" };
const other: ScopeSessionOption = {
  id: "pe.app-27",
  label: "pe.app-27",
  document: door,
  documentLabel: "Door-Single.rfa",
};

function mount(scope: Scope, sessions: ScopeSessionOption[]) {
  cleanup();
  const sets: Scope[] = [];
  render(
    <ScopeHead
      scope={scope}
      revision={3}
      sessions={sessions}
      documents={scopeDocuments(sessions)}
      busy={false}
      onSet={(next) => sets.push(next)}
    />,
  );
  return { sets, kind: screen.getByTestId("scope-head").getAttribute("data-scope") };
}

test("the head renders the resolution of the Scope against the fleet, one kind per state", () => {
  expect(mount({ kind: "document", document: projectA }, [one, other]).kind).toBe("resolved");
  expect(mount({ kind: "document", document: projectA }, [other]).kind).toBe("unheld");
  expect(mount({ kind: "document", document: projectA }, [one, two]).kind).toBe("ambiguous");
  expect(mount({ kind: "session", session: "gone-24" }, [one]).kind).toBe("gone");
  expect(mount({ kind: "none" }, [one, other]).kind).toBe("nothing");
});

test("an ambiguous head offers exactly the holders, and pressing one pins the Scope", () => {
  const { sets } = mount({ kind: "document", document: projectA }, [one, two, other]);
  expect(screen.queryByRole("button", { name: "pe.app-27" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "pe.app-26" }));
  expect(sets).toEqual([{ kind: "pinned", session: "pe.app-26", document: projectA }]);
  // Picking a document never names a session: the host derives the holder on every call.
  fireEvent.click(screen.getByRole("button", { name: "Door-Single.rfa" }));
  expect(sets[1]).toEqual({ kind: "document", document: door });
});
