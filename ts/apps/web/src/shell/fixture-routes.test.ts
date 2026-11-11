import {expect,test} from "vite-plus/test";
import {routeRegistry} from "../route/registry";
test("typed routes expose discovery data without body, seed or Work-reading adapters",()=>{
  for(const {module} of Object.values(routeRegistry)) {
    expect("spec" in module).toBe(true);
    expect(module.data.seeds).toEqual({});
    expect(Object.values(module.data.readings).some(read=>read.kind === "work")).toBe(false);
  }
  expect(routeRegistry.home!.module.data.address).toBe("/");
});
