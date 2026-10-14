/**
 * Each Pod's activation on this host, through the declared plugin doors (`plugin.update`,
 * `plugin.remove`): the only way to turn a Pod off. Remove is the host's DELETE, which disables:
 * the Pod's folder is the user's and stays in Pods. It asks first, naming the routes that go away.
 */
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { PluginStatus, PodRouteDescriptor } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ArmingStrip } from "#/components/lang/arming-strip";
import { OutcomeLine } from "#/components/lang/outcome";
import { SwitchRow } from "#/components/lang/switch-row";
import { peClient } from "#/host/pe-client";
import { useAction } from "#/readings";

/** The four declared plugin doors this page uses. */
export interface PluginsClient {
  list(): Promise<PluginStatus[]>;
  routes(): Promise<PodRouteDescriptor[]>;
  update(id: string, enabled: boolean): Promise<PluginStatus[]>;
  remove(id: string): Promise<PluginStatus[]>;
}
const hostPlugins: PluginsClient = {
  list: () => peClient.call("plugins.list", {}),
  routes: () => peClient.call("plugins.routes", {}),
  update: (id, enabled) => peClient.call("plugin.update", { params: { id }, body: { enabled } }),
  remove: (id) => peClient.call("plugin.remove", { params: { id } }),
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
  const [arming, setArming] = useState<string | null>(null);
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
    (send: () => Promise<PluginStatus[]>) => send(),
    (next) => {
      setStatuses(next);
      setArming(null);
      setError(null);
    },
  );
  const busy = write.isPending;
  const change = (send: () => Promise<PluginStatus[]>) =>
    void write
      .mutateAsync(send)
      .catch((cause: unknown) => setError(`The host did not take that: ${String(cause)}`));
  return (
    <div className="flex flex-col gap-1 px-2 py-1 hairline-b" aria-label="Pod activation">
      {pods.map((pod) => {
        const plugin = statuses?.find((status) => status.id === `pod:${pod.id}`);
        const served = routes.filter((route) => route.packageId === pod.id).map((r) => r.name);
        const id = `pod:${pod.id}`;
        return (
          <div key={pod.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SwitchRow
                  label={pod.name}
                  checked={plugin?.status === "active"}
                  onCheckedChange={(enabled) => change(() => client.update(id, enabled))}
                  refusal={
                    statuses === null
                      ? "Reading this Pod's activation"
                      : !plugin
                        ? "This host lists no activation for this Pod"
                        : plugin.status === "error"
                          ? (plugin.error ?? "This Pod failed to activate")
                          : null
                  }
                  disabled={busy}
                  says="On: the host runs this Pod's plugin and serves its routes"
                />
              </div>
              <Button
                label={`Remove ${pod.name}`}
                icon={Trash2}
                refusal={plugin ? null : "This host lists no activation for this Pod"}
                onClick={() => setArming(pod.id)}
              />
            </div>
            {arming === pod.id && (
              <ArmingStrip
                verb="remove"
                target={pod.name}
                icon={Trash2}
                says={`Turns ${pod.name} off on this host; its folder stays in Pods.${
                  served.length
                    ? ` Its route${served.length === 1 ? "" : "s"} ${served.join(", ")} ${served.length === 1 ? "goes" : "go"} away.`
                    : ""
                }`}
                state={{ phase: "arming" }}
                busy={busy}
                onCommit={() => change(() => client.remove(id))}
                onCancel={() => setArming(null)}
              />
            )}
          </div>
        );
      })}
      {error && <OutcomeLine kind="refused" label={error} />}
    </div>
  );
}
