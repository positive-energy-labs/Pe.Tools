import type { UpdatePlan } from "@pe/host-contracts/pe-revit-contract";

/**
 * The route head's own host calls, at the sanctioned altitude. `design-adherence`'s
 * `hostBelowRoute` metric counts `fetch(` outside `routes/`, `host/`, `state/`, `integrations/`
 * and files named `host|store|queries|world`, so these reads stay beside their transport boundary.
 * them. Moving them also gives the update flow one place to be read.
 */
type InstallStatus = {
  installed: boolean;
  releaseVersion: string | null;
};

type UpdateAvailability = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** No Revit, or every one idle with nothing unsaved: the update applies without asking. */
  quiet: boolean;
  planId?: string;
  revits?: UpdatePlan["revits"];
  blockers?: UpdatePlan["blockers"];
  error?: string;
};

type UpdateAcknowledgement = {
  accepted?: boolean;
  reason?: string;
  installedVersion?: string | null;
  latestVersion?: string | null;
  planId?: string;
  requestId?: string;
  receiptPath?: string;
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

export async function acknowledgeUpdate(planId: string): Promise<UpdateAcknowledgement> {
  const response = await fetch("/host/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId }),
  });
  const body = (await response.json()) as Omit<UpdateAcknowledgement, "status">;
  return { ...body, status: response.status };
}

/** The host exits after handing off; poll until its successor proves a new release. */
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
  throw new Error(
    "Update started, but the app did not come back within 3 minutes; it reopens by itself when the install finishes.",
  );
}
