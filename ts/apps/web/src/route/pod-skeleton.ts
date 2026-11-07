/** Typed module source, ready for the same publisher and registry as builtin routes. */
export function podRouteSkeleton(packageId: string, slug: string) {
  if(!/^[a-z][a-z0-9-]*$/.test(packageId) || !/^[a-z][a-z0-9-]*$/.test(slug))
    throw Error("Use lowercase package and route slugs");
  const key=`pod.${packageId}.${slug}`;
  const artifact=`routes/${slug}/route.artifact`;
  const address=`/tool/${encodeURIComponent(`route:@${packageId}/${artifact}`)}`;
  return `import { z } from "zod";
import { route, field, paneLayout } from "@pe/web/route";

export const module = route({
  key: ${JSON.stringify(key)},
  address: ${JSON.stringify(address)},
  name: ${JSON.stringify(slug)},
  needs: "browser",
  directory: {label:${JSON.stringify(slug)},summary:"Describe the purpose of this tool",group:"Pod tools",
    exposure:"Preview",icon:"Box",runtimeNeed:"Browser",aliases:[],listed:true,satellites:[],
    surfaces:{web:"full",pwa:"full",tray:false}},
  fields: {note:field(z.string(),"","pose")},
  panes: {main:{title:"Worksheet",purpose:"Describe what this pane helps decide",draw:ctx=>ctx.page.read().note}},
  layout:paneLayout("main"),
});
`;
}
