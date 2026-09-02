import { useState, type ReactNode } from "react";

import { useChatTarget } from "#/chat/chat-target";
import { Press } from "#/components/lang/press";
import { useFleet } from "#/host/fleet";
import { RouteHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import { product } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";
import { useWorkbench } from "#/workbench/provider";

/** Chat uses the same kit as route heads; the world picker is its only targeting slot. */
export function ChatSentence({
  name,
  aside,
  live,
}: {
  name: string;
  aside?: ReactNode;
  live?: boolean;
}) {
  const { revit } = useWorkbench();
  const fleet = useFleet({ enabled: revit === true });
  const { selector, resolution, pin } = useChatTarget();
  const [open, setOpen] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const worldFeed = worldTrunk.feed(fleet);
  const legalSelector =
    resolution.kind === "resolved" && worldFeed.options?.some((option) => option.id === selector)
      ? selector
      : null;
  const manifest = product("chat", "target", { world: worldTrunk.link })({
    feeds: { world: worldFeed },
    stages: [{ key: "address", label: "address", verbs: [] }],
    panes: [],
  });
  const state: BindingState<"world"> = {
    bound: { world: legalSelector },
    multi: {},
    stage: "address",
  };
  const bindings = useBindings(
    manifest,
    state,
    (patch) => patch.bound?.world !== undefined && pin(patch.bound.world ?? ""),
    open,
    setOpen,
    level,
    setLevel,
    query,
    setQuery,
  );
  const runner = useRunner(manifest, bindings);
  return (
    <RouteHead
      name={name}
      aside={aside}
      instrumentLive={live}
      manifest={{
        mode: "line",
        product: manifest,
        b: bindings,
        runner,
        extra: () =>
          selector ? (
            <Press type="button" tone="quiet" onClick={() => pin("")}>
              clear target
            </Press>
          ) : null,
      }}
    />
  );
}
