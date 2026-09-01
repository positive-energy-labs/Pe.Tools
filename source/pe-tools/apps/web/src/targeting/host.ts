/**
 * The route head's own host calls, at the sanctioned altitude. `design-adherence`'s
 * `hostBelowRoute` metric counts `fetch(` outside `routes/`, `host/`, `state/`, `integrations/`
 * and files named `host|store|queries|world` — the cluster is chrome that lives under
 * `targeting/`, so its three service reads live here rather than in the component that draws
 * them. Moving them also gives the update flow one place to be read.
 */
export type InstallStatus = {
  installed: boolean;
  releaseVersion: string | null;
};

export type UpdateAvailability = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  error?: string;
};

export type UpdateAcknowledgement = {
  accepted?: boolean;
  reason?: string;
  installedVersion?: string | null;
  error?: string;
  status: number;
};

export async function readInstallStatus(): Promise<InstallStatus> {
  const response = await fetch("/host/install");
  if (!response.ok) throw new Error(`install status failed (${response.status})`);
  return response.json() as Promise<InstallStatus>;
}

export async function readUpdateAvailability(): Promise<UpdateAvailability> {
  const response = await fetch("/host/update");
  if (!response.ok) throw new Error(`update check failed (${response.status})`);
  return response.json() as Promise<UpdateAvailability>;
}

export async function acknowledgeUpdate(): Promise<UpdateAcknowledgement> {
  const response = await fetch("/host/update", { method: "POST" });
  const body = (await response.json()) as Omit<UpdateAcknowledgement, "status">;
  return { ...body, status: response.status };
}

/** The old host exits after commit; poll the receipt until its replacement proves a new release. */
export async function waitForVersionChange(previousVersion: string | null): Promise<string> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const next = await readInstallStatus();
      if (next.releaseVersion && next.releaseVersion !== previousVersion)
        return next.releaseVersion;
    } catch {
      // The replacement host is not serving yet; keep asking until the deadline.
    }
  }
  throw new Error("Update started, but the new host did not come back within 3 minutes.");
}
