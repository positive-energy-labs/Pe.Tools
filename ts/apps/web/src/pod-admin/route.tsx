import { useState } from "react";
import { type PluginStatus, type PodRouteDescriptor } from "@pe/agent-contracts";
import { List } from "@pe/kit/lang/list-popup";
import { Input } from "@pe/kit/lang/input";
import { Button } from "@pe/kit/lang/button";
import { SwitchRow } from "@pe/kit/lang/switch-row";
import { peClient } from "#/host/pe-client";
import { mountRoute, routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { podAdminGraph, type AdminPage } from "./graph";
function Inventory({ owner, page }: MountBody<AdminPage, unknown>) {
  const [archivePath, setArchivePath] = useState("");
  const reading = owner.readings.get("inventory");
  const value = reading.value as { statuses: PluginStatus[]; routes: PodRouteDescriptor[] } | null;
  const selected = value?.statuses.find((row) => row.id === page.pod);
  const install = owner.control("install", { archivePath });
  return (
    <>
      <a href={owner.fixture ? "/pods?fixture=browse" : "/pods"}>Author Pod members</a>
      <label>
        Archive path{" "}
        <Input
          aria-label="Pod archive path"
          value={archivePath}
          onChange={(event) => setArchivePath(event.target.value)}
        />
      </label>
      <Button
        label="Install Pod archive"
        refusal={install.refusal}
        onClick={() => void install.run()}
      >
        Install Pod archive
      </Button>
      <List
        aria-label="Installed Pods"
        items={value?.statuses ?? []}
        keyOf={(row) => row.id}
        labelOf={(row) => row.id}
        onPick={(row) => void owner.control("select", { pod: row.id }).run()}
        row={(row) => ({ label: row.id, meta: row.status, active: row.id === page.pod })}
        empty="No Pods installed. Install a Pod archive."
        failure={reading.error}
      />
      {selected && (
        <SwitchRow
          label={selected.id}
          checked={selected.status === "active"}
          onCheckedChange={(enabled) =>
            void owner.control("activation", { id: selected.id, enabled }).run()
          }
          refusal={
            owner.control("activation", { id: selected.id, enabled: selected.status !== "active" })
              .refusal
          }
          says={
            selected.error ??
            "Activation runs this Pod's host hooks; deactivation keeps Work and receipts."
          }
        />
      )}
      {value?.routes
        .filter((route) => `pod:${route.packageId}` === page.pod)
        .map((route) => (
          <SwitchRow
            key={route.key}
            label={`Trust ${route.name}`}
            checked={route.trusted}
            refusal={
              owner.control("trust", {
                key: route.key,
                fingerprint: route.fingerprint,
                trusted: !route.trusted,
              }).refusal
            }
            onCheckedChange={(trusted) =>
              void owner
                .control("trust", { key: route.key, fingerprint: route.fingerprint, trusted })
                .run()
            }
            says={`Executable module ${route.fingerprint}`}
          />
        ))}
    </>
  );
}
export const podAdminAdapters: RouteAdapters<AdminPage, unknown> = {
  sources: {
    "pod-admin.inventory": {
      kind: "use",
      effects: () => [],
      async open(ctx, deliver) {
        try {
          const [statuses, routes] = await Promise.all([
            peClient.call("plugins.list", {}),
            peClient.call("plugins.routes", {}),
          ]);
          if (!ctx.signal.aborted)
            deliver({ kind: "complete", value: { statuses, routes }, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  },
  bodies: { inventory: (body) => <Inventory {...body} /> },
};
export const PodAdminRoute = mountRoute(podAdminGraph, podAdminAdapters);
export const podAdminRoute = routeFromGraph(podAdminGraph, podAdminAdapters, "/pod-admin");
