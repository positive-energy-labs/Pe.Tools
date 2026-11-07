import type { SchedulesDrawContext } from "./route";
export function bindings(ctx:SchedulesDrawContext) {
  const target=ctx.target?.kind === "document"?ctx.target.ref:null;
  const shown=ctx.value.value?.reading;
  const native=!!target&&shown?.target.session===target.session&&shown?.target.openId===target.openId;
  return {observation:{scope:shown?{document:native?target:null,source:native?"native" as const:"saved" as const}:null}};
}
