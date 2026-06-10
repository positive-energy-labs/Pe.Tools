import { expect, test } from "vite-plus/test";
import { PeCodeCliCommands, PeaCliCommands, ScriptingTools } from "../src/index.ts";

test("exports command composition and shared scripting surfaces", () => {
  expect(new PeaCliCommands().commands()).toHaveProperty("script");
  expect(new PeCodeCliCommands().commands()).toHaveProperty("live");
  expect(ScriptingTools).toBeTypeOf("function");
});
