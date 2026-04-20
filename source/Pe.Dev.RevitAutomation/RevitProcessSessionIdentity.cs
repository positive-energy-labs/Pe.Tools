namespace Pe.Dev.RevitAutomation;

public sealed record RevitProcessSessionIdentity(
    int ProcessId,
    DateTime ProcessStartUtc,
    string MainWindowTitle,
    int? RevitYear
);
