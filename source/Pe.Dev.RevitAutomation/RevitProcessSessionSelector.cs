using System.Diagnostics;
namespace Pe.Dev.RevitAutomation;

public sealed class RevitProcessSessionSelector {
    public IReadOnlyList<RevitProcessSessionIdentity> DiscoverSessions(int? revitYear = null) {
        var sessions = new List<RevitProcessSessionIdentity>();
        foreach (var process in Process.GetProcessesByName("Revit")) {
            try {
                if (process.MainWindowHandle == IntPtr.Zero)
                    continue;

                var title = RevitProcessIdentityResolver.GetDisplayTitle(process);
                var parsedYear = RevitProcessIdentityResolver.TryResolveRevitYear(process);
                if (revitYear.HasValue && parsedYear != revitYear.Value)
                    continue;

                sessions.Add(
                    new RevitProcessSessionIdentity(
                        process.Id,
                        process.StartTime.ToUniversalTime(),
                        title,
                        parsedYear,
                        process.Responding,
                        RevitProcessIdentityResolver.IsHung(process)
                    )
                );
            } catch {
                // Ignore inaccessible process state and keep checking other sessions.
            } finally {
                process.Dispose();
            }
        }

        return sessions
            .OrderByDescending(session => session.ProcessStartUtc)
            .ThenByDescending(session => session.ProcessId)
            .ToArray();
    }

    public RevitProcessSessionIdentity? SelectNewestVisibleSession(int? revitYear = null) =>
        this.DiscoverSessions(revitYear).FirstOrDefault();
}
