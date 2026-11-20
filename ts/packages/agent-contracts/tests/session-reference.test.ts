import { expect, it } from "vite-plus/test";
import { bridgeSessionFor } from "../src/target.ts";

// The turn that failed: instances.open printed the SDK id (`pe.app-25`) and Pea sent it back as
// target.ref.session, but the inventory is keyed by the bridge id (`session-a6e3...`).
const sessions = [
  { sessionId: "session-a6e3798a0ab86c16", sdkSessionId: "pe.app-25", connected: true },
  { sessionId: "session-0000000000000002", sdkSessionId: "acc-f1", connected: true },
  { sessionId: "session-0000000000000003", sdkSessionId: null, connected: true },
];

it("a bridge id names itself", () => {
  expect(bridgeSessionFor("session-a6e3798a0ab86c16", sessions)).toBe("session-a6e3798a0ab86c16");
});

it("the SDK id a result printed names its connected attachment", () => {
  expect(bridgeSessionFor("pe.app-25", sessions)).toBe("session-a6e3798a0ab86c16");
});

it("an SDK id with no connected attachment is left for the resolver to refuse as session-gone", () => {
  expect(bridgeSessionFor("pe.app-99", sessions)).toBe("pe.app-99");
  expect(bridgeSessionFor("pe.app-25", [{ ...sessions[0]!, connected: false }])).toBe("pe.app-25");
});

it("an SDK id shared by two attachments names neither", () => {
  const twins = [sessions[0]!, { ...sessions[1]!, sdkSessionId: "pe.app-25" }];
  expect(bridgeSessionFor("pe.app-25", twins)).toBe("pe.app-25");
});

it("a bridge id wins over an SDK id spelled the same", () => {
  const clash = [
    { sessionId: "x", sdkSessionId: null, connected: true },
    { sessionId: "y", sdkSessionId: "x", connected: true },
  ];
  expect(bridgeSessionFor("x", clash)).toBe("x");
});
