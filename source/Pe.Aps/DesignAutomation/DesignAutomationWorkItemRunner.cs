using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public sealed class DesignAutomationWorkItemRunner {
    public async Task<SubmittedDesignAutomationWorkItem> SubmitAsync(
        Func<AutomationApiClient> createAutomationClient,
        AutomationWorkItemSpec spec,
        string progressMessage,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        log?.Invoke(progressMessage);
        var submission = await createAutomationClient().SubmitWorkItemAsync(spec, cancellationToken)
            .ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(submission.Id))
            throw new InvalidOperationException("Automation workitem submission did not return an id.");

        log?.Invoke($"Automation: workitem {submission.Id}");
        return new SubmittedDesignAutomationWorkItem(submission.Id, submission);
    }

    public async Task<AutomationWorkItemStatus> WaitForTerminalAsync(
        Func<AutomationApiClient> createAutomationClient,
        SubmittedDesignAutomationWorkItem submission,
        DateTime deadlineUtc,
        CancellationToken cancellationToken
    ) {
        var status = submission.WorkItemStatus;
        while (!DesignAutomationRunHelpers.IsTerminal(status.Status) && DateTime.UtcNow < deadlineUtc) {
            await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken).ConfigureAwait(false);
            status = await createAutomationClient().GetWorkItemStatusAsync(submission.Id, cancellationToken)
                .ConfigureAwait(false);
        }

        return status;
    }
}

public sealed record SubmittedDesignAutomationWorkItem(string Id, AutomationWorkItemStatus WorkItemStatus);
