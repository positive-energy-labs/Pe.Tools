/**
 * Each Pod's activation on this host. The switch is the one way to turn a Pod on or off
 * (`plugin.update`); the Pod's folder is the user's and stays in Pods either way. The switch says
 * which routes the Pod serves, since they go away while it is off.
 */
import { useEffect, useState } from "react";
import type { PluginStatus, PodRouteDescriptor } from "@pe/agent-contracts";
import { OutcomeLine } from "#/components/lang/outcome";
import { SwitchRow } from "#/components/lang/switch-row";
import { peClient } from "#/host/pe-client";
import { useAction } from "#/readings";

/** The declared plugin doors this page uses. */
export interface PluginsClient {
  list(): Promise<PluginStatus[]>;
  routes(): Promise<PodRouteDescriptor[]>;
  update(id: string, enabled: boolean): Promise<PluginStatus[]>;
}
const hostPlugins: PluginsClient = {
  list: () => peClient.call("plugins.list", {}),
  routes: () => peClient.call("plugins.routes", {}),
  update: (id, enabled) => peClient.call("plugin.update", { params: { id }, body: { enabled } }),
};

export function PodPlugins({
  pods,
  client = hostPlugins,
}: {
  pods: readonly { id: string; name: string }[];
  client?: PluginsClient;
}) {
  const [statuses, setStatuses] = useState<PluginStatus[] | null>(null);
  const [routes, setRoutes] = useState<PodRouteDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([client.list(), client.routes()])
      .then(([listed, served]) => {
        setStatuses(listed);
        setRoutes(served);
      })
      .catch((cause: unknown) => setError(`Pod activation is unreadable: ${String(cause)}`));
  }, [client]);
  const write = useAction(
    ({ id, enabled }: { id: string; enabled: boolean }) => client.update(id, enabled),
    (next) => {
      setStatuses(next);
      setError(null);
    },
  );
  return (
    <div className="flex flex-col gap-1 px-2 py-1 hairline-b" aria-label="Pod activation">
      {pods.map((pod) => {
        const plugin = statuses?.find((status) => status.id === `pod:${pod.id}`);
        const served = routes.filter((route) => route.packageId === pod.id).map((r) => r.name);
        return (
          <SwitchRow
            key={pod.id}
            label={pod.name}
            checked={plugin?.status === "active"}
            onCheckedChange={(enabled) =>
              void write
                .mutateAsync({ id: `pod:${pod.id}`, enabled })
                .catch((cause: unknown) => setError(`The host did not take that: ${String(cause)}`))
            }
            refusal={
              statuses === null
                ? "Reading this Pod's activation"
                : !plugin
                  ? "This host lists no activation for this Pod"
                  : plugin.status === "error"
                    ? (plugin.error ?? "This Pod failed to activate")
                    : null
            }
            disabled={write.isPending}
            says={`On: the host runs this Pod's plugin${
              served.length
                ? ` and serves its route${served.length === 1 ? "" : "s"} ${served.join(", ")}`
                : ""
            }. Off: the folder stays in Pods.`}
          />
        );
      })}
      {error && <OutcomeLine kind="refused" label={error} />}
    </div>
  );
}
