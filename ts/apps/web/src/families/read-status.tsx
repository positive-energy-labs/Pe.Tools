import { ActionButton } from "#/components/lang/action-button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "#/components/lang/dialog";
import { Press } from "#/components/lang/press";
import { ChangedInRevit } from "#/route/changed";
import type { FamiliesObservation } from "./host";
import { filterWords } from "./scope-band";

/** The displayed read owns its provenance and diagnostics, together in the Situation. */
export function FamiliesReadStatus({
  reading,
  error,
  failure = "Couldn't load this saved read.",
  loading = false,
  archived = false,
  changed = false,
  retry,
  readAgain,
  busy = false,
  readbackError,
}: {
  reading: FamiliesObservation | null;
  error?: string | null;
  failure?: string;
  loading?: boolean;
  archived?: boolean;
  changed?: boolean;
  retry?: () => void;
  readAgain?: () => void;
  busy?: boolean;
  readbackError?: string | null;
}) {
  if (!reading && !error && !loading && !readbackError) return null;
  const issues = reading?.result.issues ?? [];
  const truncated = reading?.result.page?.isTruncated ? reading.result.page : null;
  const verified = reading?.readback?.verifiedFamilies ?? [];
  return (
    <div className="min-w-0 py-1 t-small" aria-label="Read provenance and status">
      {reading ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
          {!archived ? (
            <>
              Last read ·{" "}
              <time dateTime={reading.capturedAt}>
                {new Date(reading.capturedAt).toLocaleString()}
              </time>
            </>
          ) : null}
          {archived ? filterWords(reading.filter) : null}
          {archived ? " · inspection only" : null}
          {verified.length ? (
            <Dialog>
              <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
                {verified.length} {verified.length === 1 ? "family" : "families"} verified after
                apply
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Verified after apply</DialogTitle>
                <p className="t-small text-ink-2">
                  These families were read from the loaded project after apply. Other families
                  retain their earlier values.
                </p>
                {verified.map((family) => (
                  <p key={family.name} className="t-small">
                    {family.name} · {new Date(family.at).toLocaleString()}
                  </p>
                ))}
              </DialogContent>
            </Dialog>
          ) : null}
          {!archived && changed && readAgain ? (
            <ChangedInRevit what="the loaded families" busy={busy} onReadAgain={readAgain} />
          ) : !archived && changed ? (
            " · may be stale"
          ) : null}
          {truncated ? " · incomplete coverage" : ""}
          {issues.length || truncated ? (
            <Dialog>
              <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
                {issues.length
                  ? `${issues.length} read issue${issues.length === 1 ? "" : "s"}`
                  : "Read coverage"}
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Read issues</DialogTitle>
                <p className="t-small text-ink-2">
                  {reading.documentTitle ?? filterWords(reading.filter)} ·{" "}
                  {new Date(reading.completedAt).toLocaleString()}
                </p>
                {truncated ? (
                  <p>
                    {truncated.returnedCount} of {truncated.totalCount} families returned.
                  </p>
                ) : null}
                {issues.map((issue, index) => (
                  <div key={`${issue.code}:${index}`} className="min-w-0 break-words t-small">
                    <p className="font-semibold">{issue.familyName ?? issue.code}</p>
                    <p className="text-ink-2">{issue.message}</p>
                  </div>
                ))}
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      ) : null}
      {error || loading ? (
        <div className="flex flex-wrap items-center gap-2" role={error ? "alert" : "status"}>
          <span data-tone={error ? "caution" : undefined}>
            {loading ? "Loading saved read…" : failure}
          </span>
          {error && retry ? (
            <ActionButton
              label="Retry"
              reason="Try loading the saved data again; does not read Revit"
              onClick={retry}
              busy={loading}
            />
          ) : null}
          {error ? (
            <Dialog>
              <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
                Error details
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Saved read unavailable</DialogTitle>
                <pre className="whitespace-pre-wrap break-words face-mono t-small">{error}</pre>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      ) : null}
      {readbackError ? (
        <Dialog>
          <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
            Readback unavailable
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Readback unavailable</DialogTitle>
            <p className="t-small">
              The apply receipt is retained. The table could not be updated with verified values.
            </p>
            <p className="break-words t-small text-ink-2">{readbackError}</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
