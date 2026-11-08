import type { Reading, Machine } from "@pe/agent-contracts";
import { SettingsBody } from "#/machine/body";
import { useSurfaceHost } from "#/navigation/surface-host";
import type { SettingsContext } from "./route.ts";

export function SettingsDrawing({ ctx }: { ctx: SettingsContext }) {
  const { section, session } = ctx.page.read();
  const host = useSurfaceHost();
  // Machine drawings predate Value's deep readonly projection; they only inspect this value.
  const machine = ctx.value.value?.machine as Machine | undefined;
  const reading: Reading<Machine> =
    ctx.value.current && machine
      ? { state: "ready", observation: machine }
      : ctx.value.status === "failed"
        ? { state: "failed", message: ctx.value.reason, previous: machine }
        : machine
          ? { state: "stale", reason: "disconnected", previous: machine }
          : { state: "absent" };
  return (
    <main
      data-surface="page"
      className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-2"
      aria-label="settings"
    >
      <div className="mx-auto w-full max-w-3xl">
        <SettingsBody
          reading={reading}
          fixture={false}
          shell={host.surface}
          group={section === "none" ? null : section}
          session={session || undefined}
          onGroup={(next) => ctx.page.query({ section: next ?? "none" })}
        />
      </div>
    </main>
  );
}
