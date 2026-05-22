using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class RevitTestExecutionPlanner {
    public static RevitTestExecutionPlan Resolve(
        RevitTestCliOptions options,
        RevitTestBuildMatrix matrix,
        IReadOnlyList<RevitProcessSessionIdentity> sessions,
        IReadOnlyList<RevitTestOwnedSessionState> ownedSessions
    ) {
        var runningYears = sessions
            .Where(session => session.RevitYear.HasValue)
            .Select(session => session.RevitYear!.Value)
            .ToHashSet();

        string configuration;
        int revitYear;

        if (!string.IsNullOrWhiteSpace(options.ConfigurationOverride)) {
            configuration = options.ConfigurationOverride;
            revitYear = RevitTestBuildMatrix.ParseYearFromConfiguration(configuration);
        } else if (options.RevitYearOverride.HasValue) {
            revitYear = options.RevitYearOverride.Value;
            configuration = matrix.ResolveDefaultTestConfiguration(revitYear);
        } else {
            var compatibleYears = matrix.SupportedRevitYears
                .Where(year => IsCompatibleWithDefaultYear(year, matrix.DefaultRevitYear))
                .ToArray();
            revitYear = SelectSafeYear(matrix.DefaultRevitYear, compatibleYears, runningYears, ownedSessions);
            configuration = matrix.ResolveDefaultTestConfiguration(revitYear);
        }

        var ownedSession = ownedSessions.FirstOrDefault(session => session.RevitYear == revitYear);
        var ownedProcessIds = ownedSessions
            .Where(session => session.RevitYear == revitYear)
            .Select(session => session.ProcessId)
            .ToHashSet();
        var nonOwnedRunningSession = sessions.FirstOrDefault(session =>
            session.RevitYear == revitYear &&
            !ownedProcessIds.Contains(session.ProcessId)
        );
        if (nonOwnedRunningSession is not null) {
            throw new InvalidOperationException(
                $"Revit {revitYear} already has a running session that is not owned by `pe-dev test` (pid={nonOwnedRunningSession.ProcessId}). Close that session or choose a different year."
            );
        }

        var reason = ResolveReason(matrix.DefaultRevitYear, revitYear, runningYears, ownedSession);
        return new RevitTestExecutionPlan(
            configuration,
            revitYear,
            options.Filter,
            options.NoBuild,
            options.AllowDeployedAddin,
            ownedSession,
            reason
        );
    }

    private static string ResolveReason(
        int defaultYear,
        int selectedYear,
        ISet<int> runningYears,
        RevitTestOwnedSessionState? ownedSession
    ) {
        if (ownedSession is not null)
            return $"owned-test-year year={ownedSession.RevitYear} pid={ownedSession.ProcessId}";

        if (runningYears.Contains(defaultYear) && selectedYear != defaultYear)
            return $"auto-shifted-away-from-running-year from={defaultYear} to={selectedYear}";

        return "fresh-owned-test-session";
    }

    private static int SelectSafeYear(
        int defaultYear,
        IReadOnlyList<int> supportedYears,
        ISet<int> runningYears,
        IReadOnlyList<RevitTestOwnedSessionState> ownedSessions
    ) {
        var ownedYear = ownedSessions
            .Select(session => session.RevitYear)
            .Where(supportedYears.Contains)
            .OrderBy(year => Math.Abs(year - defaultYear))
            .ThenByDescending(year => year)
            .FirstOrDefault();
        if (ownedYear != 0)
            return ownedYear;

        var nonRunningYear = supportedYears
            .Distinct()
            .Where(year => !runningYears.Contains(year))
            .OrderBy(year => Math.Abs(year - defaultYear))
            .ThenByDescending(year => year)
            .FirstOrDefault();
        if (nonRunningYear != 0)
            return nonRunningYear;

        throw new InvalidOperationException(
            $"No safe Revit test year is available in the default runtime family around Revit {defaultYear}. Running years: {string.Join(", ", runningYears.OrderBy(year => year))}."
        );
    }

    private static bool IsCompatibleWithDefaultYear(int candidateYear, int defaultYear) =>
        ResolveRuntimeFamily(candidateYear) == ResolveRuntimeFamily(defaultYear);

    private static string ResolveRuntimeFamily(int revitYear) => revitYear >= 2025 ? "net8" : "net48";
}
