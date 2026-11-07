import type { CapturesContext } from "./route.ts";
import { CapturesList } from "./list.tsx";

export function CapturesDrawing({ ctx }: { ctx: CapturesContext }) {
  const page = ctx.page.read();
  return <>
    {!ctx.value.current && <p role="status">{ctx.value.reason}</p>}
    <CapturesList captures={ctx.value.value?.captures ?? []} focus={page.focus || undefined} open={page.open}
      onPage={next => ctx.page.pose({ focus: next.sha ?? "", ...(next.open ? { open: [...next.open] } : {}) }, "named")} />
  </>;
}
