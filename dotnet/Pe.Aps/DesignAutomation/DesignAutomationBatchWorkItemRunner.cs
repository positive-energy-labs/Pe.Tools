using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public sealed class DesignAutomationBatchWorkItemRunner {
    public async Task RunGroupAsync<TEntry, TTracker, TResult>(
        IReadOnlyCollection<TEntry> entries,
        int maxConcurrency,
        int timeoutSeconds,
        Func<TEntry, Task<DesignAutomationBatchSubmission<TTracker, TResult>>> submitAsync,
        Func<TTracker, AutomationWorkItemStatus, Task<TResult>> finalizeAsync,
        Func<TTracker, int, TResult> buildTimedOutResult,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        ICollection<TResult> results,
        CancellationToken cancellationToken
    ) where TTracker : IDesignAutomationBatchWorkItemTracker {
        var pending = new Queue<TEntry>(entries);
        var active = new Dictionary<string, TTracker>(StringComparer.Ordinal);
        var concurrency = Math.Max(1, maxConcurrency);

        while ((pending.Count > 0 || active.Count > 0) && !cancellationToken.IsCancellationRequested) {
            while (pending.Count > 0 && active.Count < concurrency) {
                var submission = await submitAsync(pending.Dequeue()).ConfigureAwait(false);
                if (submission.SubmissionFailure != null) {
                    results.Add(submission.SubmissionFailure);
                    continue;
                }

                if (submission.Tracker != null)
                    active[submission.Tracker.WorkItemId] = submission.Tracker;
            }

            if (active.Count == 0)
                continue;

            await Task.Delay(DesignAutomationRunHelpers.BatchPollingInterval, cancellationToken).ConfigureAwait(false);
            var statuses = await GetLatestStatusesForTrackersAsync(active.Values.ToArray(), createAutomationClient, log, cancellationToken)
                .ConfigureAwait(false);

            foreach (var status in statuses) {
                if (string.IsNullOrWhiteSpace(status.Id) || !active.TryGetValue(status.Id, out var tracker))
                    continue;

                if (!DesignAutomationRunHelpers.IsTerminal(status.Status))
                    continue;

                results.Add(await finalizeAsync(tracker, status).ConfigureAwait(false));
                active.Remove(status.Id);
            }

            foreach (var expiredWorkItemId in active.Values
                         .Where(tracker => tracker.DeadlineUtc <= DateTime.UtcNow)
                         .Select(tracker => tracker.WorkItemId)
                         .ToArray()) {
                if (active.Remove(expiredWorkItemId, out var tracker))
                    results.Add(buildTimedOutResult(tracker, timeoutSeconds));
            }
        }
    }

    private static Task<IReadOnlyList<AutomationWorkItemStatus>> GetLatestStatusesForTrackersAsync<TTracker>(
        IReadOnlyCollection<TTracker> trackers,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) where TTracker : IDesignAutomationBatchWorkItemTracker =>
        GetLatestStatusesAsync(
            trackers.Select(tracker => tracker.WorkItemId).ToArray(),
            createAutomationClient,
            log,
            cancellationToken
        );

    public static async Task<IReadOnlyList<AutomationWorkItemStatus>> GetLatestStatusesAsync(
        IReadOnlyCollection<string> workItemIds,
        Func<AutomationApiClient> createAutomationClient,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (workItemIds.Count == 0)
            return [];

        var distinctWorkItemIds = workItemIds
            .Where(workItemId => !string.IsNullOrWhiteSpace(workItemId))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (distinctWorkItemIds.Length == 0)
            return [];

        IReadOnlyList<AutomationWorkItemStatus> batchStatuses = [];
        try {
            batchStatuses = await createAutomationClient().GetWorkItemStatusesAsync(distinctWorkItemIds, cancellationToken)
                .ConfigureAwait(false);
        } catch (Exception ex) {
            log?.Invoke(
                $"Automation: batch status fetch failed for {distinctWorkItemIds.Length} workitems; falling back to per-item status checks. {ex.Message}");
        }

        var statuses = new List<AutomationWorkItemStatus>(distinctWorkItemIds.Length);
        var seenWorkItemIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var status in batchStatuses) {
            if (string.IsNullOrWhiteSpace(status.Id) || !seenWorkItemIds.Add(status.Id))
                continue;

            statuses.Add(status);
        }

        foreach (var workItemId in distinctWorkItemIds) {
            if (seenWorkItemIds.Contains(workItemId))
                continue;

            try {
                var status = await createAutomationClient().GetWorkItemStatusAsync(workItemId, cancellationToken)
                    .ConfigureAwait(false);
                statuses.Add(string.IsNullOrWhiteSpace(status.Id)
                    ? new AutomationWorkItemStatus {
                        Id = workItemId,
                        Status = status.Status,
                        ReportUrl = status.ReportUrl
                    }
                    : status);
            } catch (Exception ex) {
                log?.Invoke($"Automation: status check failed for workitem {workItemId}. {ex.Message}");
            }
        }

        return statuses;
    }
}

public interface IDesignAutomationBatchWorkItemTracker {
    string WorkItemId { get; }
    DateTime DeadlineUtc { get; }
}

public sealed class DesignAutomationBatchSubmission<TTracker, TResult>
    where TTracker : IDesignAutomationBatchWorkItemTracker {
    public TTracker? Tracker { get; private init; }
    public TResult? SubmissionFailure { get; private init; }

    public static DesignAutomationBatchSubmission<TTracker, TResult> Submitted(TTracker tracker) => new() { Tracker = tracker };

    public static DesignAutomationBatchSubmission<TTracker, TResult> Failed(TResult failure) => new() { SubmissionFailure = failure };
}
