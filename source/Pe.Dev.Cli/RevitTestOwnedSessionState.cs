using Pe.Dev.RevitAutomation;
using System.Text.Json;

namespace Pe.Dev.Cli;

internal sealed record RevitTestOwnedSessionState(
    int RevitYear,
    int ProcessId,
    DateTime ProcessStartUtc,
    string Configuration,
    string RuntimeFingerprint,
    DateTime RecordedUtc
);

internal sealed class RevitTestOwnedSessionStateStore {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) {
        WriteIndented = true
    };

    private readonly string _stateRoot;

    private RevitTestOwnedSessionStateStore(string stateRoot) {
        this._stateRoot = stateRoot;
    }

    public static RevitTestOwnedSessionStateStore CreateDefault() {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var stateRoot = Path.Combine(
            localAppData,
            "Positive Energy",
            "Pe.Tools",
            "State",
            "revit-test",
            "sessions"
        );
        return new RevitTestOwnedSessionStateStore(stateRoot);
    }

    public RevitTestOwnedSessionState? TryGetLiveState(
        int revitYear,
        IReadOnlyList<RevitProcessSessionIdentity> visibleSessions
    ) {
        var state = this.Load(revitYear);
        if (state is null)
            return null;

        var matchingSession = visibleSessions.FirstOrDefault(session =>
            session.RevitYear == revitYear &&
            session.ProcessId == state.ProcessId &&
            session.ProcessStartUtc == state.ProcessStartUtc
        );

        if (matchingSession is null || !matchingSession.Responding || matchingSession.Hung) {
            this.Delete(revitYear);
            return null;
        }

        return state;
    }

    public IReadOnlyList<RevitTestOwnedSessionState> GetLiveStates(
        IEnumerable<int> revitYears,
        IReadOnlyList<RevitProcessSessionIdentity> visibleSessions
    ) =>
        revitYears
            .Distinct()
            .Select(revitYear => this.TryGetLiveState(revitYear, visibleSessions))
            .Where(state => state is not null)
            .Cast<RevitTestOwnedSessionState>()
            .ToArray();

    public void Save(RevitTestOwnedSessionState state) {
        Directory.CreateDirectory(this._stateRoot);
        File.WriteAllText(this.ResolvePath(state.RevitYear), JsonSerializer.Serialize(state, JsonOptions));
    }

    public void Delete(int revitYear) {
        var path = this.ResolvePath(revitYear);
        if (!File.Exists(path))
            return;

        try {
            File.Delete(path);
        } catch {
            // Best effort cleanup.
        }
    }

    private RevitTestOwnedSessionState? Load(int revitYear) {
        var path = this.ResolvePath(revitYear);
        if (!File.Exists(path))
            return null;

        try {
            return JsonSerializer.Deserialize<RevitTestOwnedSessionState>(File.ReadAllText(path), JsonOptions);
        } catch {
            this.Delete(revitYear);
            return null;
        }
    }

    private string ResolvePath(int revitYear) => Path.Combine(this._stateRoot, $"{revitYear}.json");
}
