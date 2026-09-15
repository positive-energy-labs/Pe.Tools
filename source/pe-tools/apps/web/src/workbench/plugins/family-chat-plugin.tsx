import { Link } from "@tanstack/react-router";
import { familyCaptureSchema } from "@pe/agent-contracts";
import { InlineRoutePlugin, actionLabel } from "../route-chat-plugins";
export function FamilyChatPlugin({
  toolName,
  args,
  sessionState,
  running,
}: Pick<
  import("../route-chat-plugins").RouteChatPluginProps,
  "toolName" | "args" | "sessionState" | "running"
>) {
  const raw = sessionState as { structuredContent?: unknown; result?: unknown } | undefined;
  const outer = (raw?.structuredContent ?? raw) as { result?: unknown } | undefined;
  const capture = familyCaptureSchema.safeParse(outer?.result ?? outer).data;
  return (
    <InlineRoutePlugin title="Family" action={actionLabel(toolName, args, running)}>
      <div>
        {capture ? (
          <a href={`/family/readings?id=${capture.id}`}>
            {capture.reading.kind} captured {capture.capturedAt}
          </a>
        ) : (
          "Saved Family readings"
        )}
        <Link className="ml-auto" to="/family">
          Open workspace
        </Link>
      </div>
    </InlineRoutePlugin>
  );
}
