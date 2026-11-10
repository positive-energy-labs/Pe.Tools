/** Typed module source, ready for the same publisher and registry as builtin routes. */
export function podRouteSkeleton(packageId: string, slug: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(packageId) || !/^[a-z][a-z0-9-]*$/.test(slug))
    throw Error("Use lowercase package and route slugs");
  const key = `pod.${packageId}.${slug}`;
  const artifact = `routes/${slug}/route.artifact`;
  const address = `/tool/${encodeURIComponent(`route:@${packageId}/${artifact}`)}`;
  return `import { z } from "zod";
import { route, field, paneLayout, scrollBody } from "@pe/web/route";
import {workState} from "./work.ts";

export const module = route({
  key: ${JSON.stringify(key)},
  address: ${JSON.stringify(address)},
  name: ${JSON.stringify(slug)},
  needs: "host", host:"./host.ts",
  directory: {label:${JSON.stringify(slug)},summary:"Describe the purpose of this tool",group:"Pod tools",
    exposure:"Preview",icon:"Box",runtimeNeed:"Browser",aliases:[],listed:true,satellites:[],
    surfaces:{web:"full",pwa:"full",tray:false}},
  fields: {note:field(z.string(),"","pose")},
  edits: {work:workState,seed:()=>workState.schema.parse({}),owners:{},
    input:z.never(),patches:()=>[],history:z.object({label:z.string()}),describe:detail=>({label:detail.label})},
  panes: {main:{title:"Worksheet",purpose:"Describe what this pane helps decide",body:"scroll",draw:ctx=>scrollBody(ctx.page.read().note)}},
  layout:paneLayout("main"),
});
`;
}

/** All three files are needed by the same browser/host publication path as builtins. */
export function podRouteFiles(packageId: string, slug: string) {
  const source = podRouteSkeleton(packageId, slug);
  return {
    "route.ts": source,
    "host.ts": "export const reads={};\nexport const leaves={};\n",
    "work.ts": `import {z} from "zod";\nexport const workState={route:${JSON.stringify(`pod.${packageId}.${slug}`)},title:${JSON.stringify(slug)},description:"Authored worksheet notes",schema:z.object({notes:z.record(z.string(),z.string()).default({})}),schemaVersion:1};\n`,
  };
}
