import { Schema } from "effect";
import { expect, test } from "vite-plus/test";
import {
  AdapterPackage,
  CodexConfig,
  MessagesReply,
  ModelList,
  ResponsesReply,
  Win32Rows,
} from "../src/harness/edge-schemas.ts";

// Harness edges the host does not author: each decodes its writer's shape and refuses a bad one.
test("harness child config, probe replies and CLI discovery decode, never cast", () => {
  expect(Schema.decodeUnknownSync(CodexConfig)('{"model_provider":"pe"}')).toEqual({
    model_provider: "pe",
  });
  expect(() => Schema.decodeUnknownSync(CodexConfig)('["not","an","object"]')).toThrow();

  expect(Schema.decodeUnknownSync(ModelList)({ data: [{ id: "claude-a" }] }).data[0]!.id).toBe(
    "claude-a",
  );
  expect(() => Schema.decodeUnknownSync(ModelList)({ data: [{ id: 7 }] })).toThrow(/id/);
  expect(() => Schema.decodeUnknownSync(ModelList)({ models: [] })).toThrow(/data/);
  expect(
    Schema.decodeUnknownSync(MessagesReply)({ content: [{ type: "text", text: "OK" }] }),
  ).toMatchObject({ content: [{ text: "OK" }] });
  expect(() => Schema.decodeUnknownSync(ResponsesReply)({ output: [{ content: [] }] })).toThrow(
    /type/,
  );

  expect(
    Schema.decodeUnknownSync(AdapterPackage)('{"name":"a","bin":{"a":"dist/index.js"}}').bin,
  ).toEqual({ a: "dist/index.js" });
  expect(() => Schema.decodeUnknownSync(AdapterPackage)('{"bin":"dist/index.js"}')).toThrow(/bin/);
  expect(Schema.decodeUnknownSync(Win32Rows)('{"code":5,"reason":"denied"}')).toEqual({
    code: 5,
    reason: "denied",
  });
  expect(() => Schema.decodeUnknownSync(Win32Rows)('{"code":"5"}')).toThrow();
});
