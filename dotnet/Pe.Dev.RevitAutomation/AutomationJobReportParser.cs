using Newtonsoft.Json.Linq;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationJobReportParser {
    private const string JobPrefix = "PE_AUTOMATION_JOB ";
    private const string ProbePrefix = "PE_AUTOMATION_PROBE ";

    public ParsedAutomationJobReport Parse(string? reportContent) {
        if (string.IsNullOrWhiteSpace(reportContent))
            return new ParsedAutomationJobReport();

        var lines = reportContent
            .Split(["\r\n", "\n"], StringSplitOptions.None)
            .Select(NormalizeMarkerLine)
            .Where(line => line != null)
            .Select(line => line!)
            .ToList();

        var result = new ParsedAutomationJobReport {
            RawExcerpt = BuildExcerpt(lines, reportContent)
        };

        foreach (var line in lines) {
            var marker = GetMarker(line);
            switch (marker) {
            case "OPEN_SUCCESS":
                result.Classification = nameof(ProbeAccessClassification.Success);
                result.DocumentTitle = ReadJsonField(line, "title");
                result.FailureMessage = null;
                break;
            case "OPEN_FAIL_UNAUTHORIZED":
                result.Classification = nameof(ProbeAccessClassification.CloudModelUnauthorized);
                result.FailureMessage = ReadFailureMessage(line);
                break;
            case "OPEN_FAIL_NOT_FOUND":
                result.Classification = nameof(ProbeAccessClassification.CloudModelNotFound);
                result.FailureMessage = ReadFailureMessage(line);
                break;
            case "OPEN_FAIL_TITLE_MISMATCH":
                result.Classification = nameof(ProbeAccessClassification.ExpectedTitleMismatch);
                result.DocumentTitle ??= ReadJsonField(line, "documentTitle");
                result.FailureMessage = ReadFailureMessage(line);
                break;
            case "OPEN_FAIL_OTHER":
                result.Classification = nameof(ProbeAccessClassification.CloudModelOpenFailed);
                result.FailureMessage = ReadFailureMessage(line);
                break;
            case "DOCUMENT_OPENED":
                result.DocumentTitle ??= ReadJsonField(line, "title") ?? ReadJsonField(line, "documentTitle");
                break;
            case "JOB_SUCCESS":
                result.JobSucceeded = true;
                result.DocumentTitle ??= ReadJsonField(line, "documentTitle");
                result.Classification ??= "Success";
                break;
            case "JOB_FAIL_UNAUTHORIZED":
                result.JobSucceeded = false;
                result.Classification ??= "CloudModelUnauthorized";
                result.FailureMessage ??= ReadFailureMessage(line);
                break;
            case "JOB_FAIL_NOT_FOUND":
                result.JobSucceeded = false;
                result.Classification ??= "CloudModelNotFound";
                result.FailureMessage ??= ReadFailureMessage(line);
                break;
            case "JOB_FAIL_TITLE_MISMATCH":
                result.JobSucceeded = false;
                result.Classification ??= nameof(ProbeAccessClassification.ExpectedTitleMismatch);
                result.DocumentTitle ??= ReadJsonField(line, "documentTitle");
                result.FailureMessage ??= ReadFailureMessage(line);
                break;
            case "JOB_FAIL_ASSEMBLY_LOAD":
                result.JobSucceeded = false;
                result.Classification ??= "AssemblyLoadFailed";
                result.FailureMessage ??= ReadFailureMessage(line);
                break;
            case "JOB_FAIL_OTHER":
                result.JobSucceeded = false;
                result.Classification ??= "JobFailed";
                result.FailureMessage ??= ReadFailureMessage(line);
                break;
            case "ARTIFACT_WRITTEN":
                result.ArtifactLocalName = ReadJsonField(line, "localName");
                break;
            }
        }

        if (result.Classification == null) {
            var titleMismatchLine = lines.LastOrDefault(line =>
                line.Contains("JOB_FAIL_TITLE_MISMATCH", StringComparison.Ordinal) ||
                line.Contains("OPEN_FAIL_TITLE_MISMATCH", StringComparison.Ordinal)
            );

            if (titleMismatchLine != null) {
                result.Classification = nameof(ProbeAccessClassification.ExpectedTitleMismatch);
                result.DocumentTitle ??=
                    ReadJsonField(titleMismatchLine, "documentTitle") ?? ReadJsonField(titleMismatchLine, "title");
                result.FailureMessage ??= ReadFailureMessage(titleMismatchLine);
            }
        }

        return result;
    }

    private static string GetMarker(string line) {
        if (!line.StartsWith(JobPrefix, StringComparison.Ordinal) &&
            !line.StartsWith(ProbePrefix, StringComparison.Ordinal))
            return "";

        var remainder = line.StartsWith(JobPrefix, StringComparison.Ordinal)
            ? line[JobPrefix.Length..]
            : line[ProbePrefix.Length..];
        var separatorIndex = remainder.IndexOf(' ');
        var markerSegment = separatorIndex >= 0 ? remainder[..separatorIndex] : remainder;

        return markerSegment.Trim();
    }

    private static string? NormalizeMarkerLine(string line) {
        if (string.IsNullOrWhiteSpace(line))
            return null;

        var jobPrefixIndex = line.IndexOf(JobPrefix, StringComparison.Ordinal);
        if (jobPrefixIndex >= 0)
            return line[jobPrefixIndex..].Trim();

        var probePrefixIndex = line.IndexOf(ProbePrefix, StringComparison.Ordinal);
        return probePrefixIndex < 0 ? null : line[probePrefixIndex..].Trim();
    }

    private static string? ReadJsonField(string line, string fieldName) {
        var payloadIndex = line.IndexOf('{');
        if (payloadIndex < 0)
            return null;

        var payload = line[payloadIndex..];
        try {
            var value = JObject.Parse(payload)[fieldName];
            return value?.Type == JTokenType.Null ? null : value?.ToString();
        } catch {
            return null;
        }
    }

    private static string? ReadFailureMessage(string line) {
        var message = ReadJsonField(line, "message") ?? ReadJsonField(line, "detail");
        if (!string.IsNullOrWhiteSpace(message))
            return message;

        var documentTitle = ReadJsonField(line, "documentTitle") ?? ReadJsonField(line, "title");
        var expectedTitle = ReadJsonField(line, "expectedTitle");
        if (!string.IsNullOrWhiteSpace(documentTitle) && !string.IsNullOrWhiteSpace(expectedTitle))
            return $"Opened document title '{documentTitle}' did not match expected title '{expectedTitle}'.";

        return null;
    }

    private static string BuildExcerpt(IReadOnlyList<string> markerLines, string fullReport) {
        if (markerLines.Count > 0)
            return string.Join(Environment.NewLine, markerLines.TakeLast(20));

        var lines = fullReport.Split(["\r\n", "\n"], StringSplitOptions.None);
        return string.Join(Environment.NewLine, lines.TakeLast(20));
    }
}

internal sealed class ParsedAutomationJobReport {
    public string? Classification { get; set; }
    public bool? JobSucceeded { get; set; }
    public string? DocumentTitle { get; set; }
    public string? FailureMessage { get; set; }
    public string? ArtifactLocalName { get; set; }
    public string? RawExcerpt { get; set; }
}
