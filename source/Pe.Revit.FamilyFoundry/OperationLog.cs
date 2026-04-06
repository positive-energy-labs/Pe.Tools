using System.Diagnostics;

namespace Pe.FamilyFoundry;

public enum LogStatus { Pending, Success, Skipped, Error }

/// <summary>
///     Log result from an operation execution
/// </summary>
public class OperationLog(string operationName, List<LogEntry> entries) {
    public string OperationName { get; init; } = operationName;
    public List<LogEntry> Entries { get; init; } = entries;
    public double MsElapsed { get; set; }
    public int SuccessCount => this.Entries.Count(e => e.Status == LogStatus.Success);
    public int SkippedCount => this.Entries.Count(e => e.Status == LogStatus.Skipped);
    public int ErrorCount => this.Entries.Count(e => e.Status == LogStatus.Error);
    public int PendingCount => this.Entries.Count(e => e.Status == LogStatus.Pending);
}

/// <summary>
///     Individual log entry for an operation with semantic state tracking.
/// </summary>
public class LogEntry {
    public LogEntry(string name) => this.Name = name;
    public string Name { get; }
    public string FamilyTypeName { get; private set; }
    private List<string> MessageList { get; } = [];

    public string Message =>
        this.MessageList.Count == 0
            ? string.Empty
            : string.Join("",
                this.MessageList.Select((msg, i) =>
                    this.MessageList.Count switch {
                        0 => string.Empty,
                        1 => msg,
                        _ => $"{i + 1}. {msg}" + $"{(i < this.MessageList.Count - 1 ? "\n" : "")}"
                    }));

    public LogStatus Status { get; private set; } = LogStatus.Pending;
    public Exception Exception { get; private set; }
    public bool IsComplete => this.Status != LogStatus.Pending;


    public LogEntry Success(string message = null) {
        this.EnsurePending();
        this.Status = LogStatus.Success;
        if (message != null) this.MessageList.Add(message);
        return this;
    }

    public LogEntry Skip(string message = null) {
        this.EnsurePending();
        this.Status = LogStatus.Skipped;
        if (message != null) this.MessageList.Add(message);
        return this;
    }

    public LogEntry Error(Exception ex) {
        this.EnsurePending();
        this.Status = LogStatus.Error;
        this.MessageList.Add(ex.ToStringDemystified());
        this.Exception = ex;
        return this;
    }

    public LogEntry Error(string message) {
        this.EnsurePending();
        this.Status = LogStatus.Error;
        this.MessageList.Add(message);
        return this;
    }

    public LogEntry Error(string message, Exception ex) {
        this.EnsurePending();
        this.Status = LogStatus.Error;
        this.MessageList.Add(message);
        this.MessageList.Add("\n");
        this.MessageList.Add(ex.ToStringDemystified());
        this.Exception = ex;
        return this;
    }

    // Non-terminal (stays Pending) 
    public LogEntry Defer(string action) {
        this.EnsurePending();
        this.MessageList.Add(action);
        return this;
    }

    /// <summary>
    ///     Creates a deep clone of this LogEntry, preserving all state except Exception.
    ///     Used to snapshot logs at operation completion to prevent Context pollution.
    /// </summary>
    public LogEntry Clone() {
        var clone = new LogEntry(this.Name) {
            FamilyTypeName = this.FamilyTypeName, Status = this.Status, Exception = this.Exception
        };
        foreach (var msg in this.MessageList)
            clone.MessageList.Add(msg);
        return clone;
    }

    /// <summary>
    ///     Clears all accumulated messages from this entry.
    ///     Used after TakeSnapshot() to prevent message accumulation across type iterations.
    /// </summary>
    internal void ClearMessages() => this.MessageList.Clear();

    private void EnsurePending() {
        if (this.IsComplete) {
            throw new InvalidOperationException(
                $"LogEntry '{this.Name}' is already complete with status {this.Status}");
        }
    }

    public void SetFamilyType(string familyTypeName) => this.FamilyTypeName = familyTypeName;
}