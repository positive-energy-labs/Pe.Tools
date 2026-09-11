/**
 * The route head's own host calls, at the sanctioned altitude. `design-adherence`'s
 * `hostBelowRoute` metric counts `fetch(` outside `routes/`, `host/`, `state/`, `integrations/`
 * and files named `host|store|queries|world` — the cluster is chrome that lives under
 * `targeting/`, so its service read lives here rather than in the component that draws it.
 */
export type InstallStatus = {
  installed: boolean;
  releaseVersion: string | null;
};

export async function readInstallStatus(): Promise<InstallStatus> {
  const response = await fetch("/host/install");
  if (!response.ok) throw new Error(`install status failed (${response.status})`);
  return response.json() as Promise<InstallStatus>;
}
