import {expect,test} from "vite-plus/test";
import {builtinModules} from "../route/builtin-modules.generated";
test("typed routes expose discovery data without body, seed or Work-reading adapters",()=>{
  for(const module of Object.values(builtinModules)) {
    expect("spec" in module).toBe(true);
    expect(module.data.seeds).toEqual({});
    expect(Object.values(module.data.readings).some(read=>read.kind === "work")).toBe(false);
  }
  expect(builtinModules.home.data.address).toBe("/");
});
