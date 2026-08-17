using Newtonsoft.Json;

namespace Pe.Revit.Takeoff;

// The identity spine's root: stable GUID <-> mutable user tag for every System (FC-8, UH-1, ...).
// project-a evidence forced this shape (DECISIONS 2026-08-14): the systemNumber<->tag binding lived
// only in hand-typed prose, tags were renamed mid-project (IU->WS) leaving the legend stale, and
// dangling tags (phantom IU-2, unparsed UH-2-4 ranges) went uncaught.
//
// This file is deliberately Revit-free: pure model + versioned fail-closed codec + reconciliation.
// The storage adapter (a hidden text param on Project Information, exactly the
// ParameterLinksProfileStorage pattern in Pe.Revit.Global) lands together with the FR-carrier
// write probe — nothing here may grow a Revit dependency.
public sealed class SystemRegistry
{
    public const int CurrentVersion = 1;

    public int Version = CurrentVersion;
    public List<SystemEntry> Systems = new();

    public string Serialize()
    {
        Validate();
        return JsonConvert.SerializeObject(this, Formatting.None);
    }

    // Fail-closed: any unreadable, wrong-version, or inconsistent blob throws — callers surface
    // the error and stop; nobody proceeds against a half-understood registry.
    public static SystemRegistry Deserialize(string json)
    {
        SystemRegistry registry;
        try
        {
            registry = JsonConvert.DeserializeObject<SystemRegistry>(json)
                       ?? throw new InvalidOperationException("registry blob is empty");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"registry blob is not valid JSON: {ex.Message}");
        }
        if (registry.Version != CurrentVersion)
            throw new InvalidOperationException(
                $"registry blob is v{registry.Version}; this build reads v{CurrentVersion}");
        registry.Validate();
        return registry;
    }

    public SystemEntry Register(string tag)
    {
        string trimmed = ValidTag(tag);
        if (FindByTag(trimmed) != null)
            throw new InvalidOperationException($"tag '{trimmed}' is already registered");
        var entry = new SystemEntry { Guid = Guid.NewGuid(), Tag = trimmed };
        this.Systems.Add(entry);
        return entry;
    }

    public void Rename(Guid guid, string newTag)
    {
        string trimmed = ValidTag(newTag);
        var entry = this.Systems.FirstOrDefault(s => s.Guid == guid)
                    ?? throw new InvalidOperationException($"no system {guid} in the registry");
        var clash = FindByTag(trimmed);
        if (clash != null && clash.Guid != guid)
            throw new InvalidOperationException($"tag '{trimmed}' already names system {clash.Guid}");
        entry.Tag = trimmed;
    }

    public SystemEntry? FindByTag(string tag) =>
        this.Systems.FirstOrDefault(s => string.Equals(s.Tag, tag.Trim(), StringComparison.OrdinalIgnoreCase));

    // Observed tags (from zone FRs) against the registry. Resolution is mechanical; a vanished
    // tag alongside an appeared one is a QUESTION (rename vs new system) — asked, never guessed.
    public TagReconciliation Reconcile(IEnumerable<string> observedTags)
    {
        var observed = observedTags
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var resolved = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        var appeared = new List<string>();
        foreach (string tag in observed)
        {
            var entry = FindByTag(tag);
            if (entry != null) resolved[tag] = entry.Guid;
            else appeared.Add(tag);
        }
        var vanished = this.Systems
            .Where(s => !observed.Contains(s.Tag, StringComparer.OrdinalIgnoreCase))
            .ToList();
        // Candidate pairs only while the question is small enough to ask one by one; beyond that
        // the lists themselves are the report.
        var candidates = vanished.Count is > 0 and <= 5 && appeared.Count is > 0 and <= 5
            ? vanished.SelectMany(v => appeared.Select(a => (From: v, To: a))).ToList()
            : new List<(SystemEntry From, string To)>();
        return new TagReconciliation(resolved, appeared, vanished, candidates);
    }

    private void Validate()
    {
        foreach (var entry in this.Systems)
        {
            if (entry.Guid == Guid.Empty)
                throw new InvalidOperationException($"registry entry '{entry.Tag}' has an empty GUID");
            _ = ValidTag(entry.Tag);
        }
        var dupGuid = this.Systems.GroupBy(s => s.Guid).FirstOrDefault(g => g.Count() > 1);
        if (dupGuid != null)
            throw new InvalidOperationException($"duplicate system GUID {dupGuid.Key}");
        var dupTag = this.Systems
            .GroupBy(s => s.Tag, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (dupTag != null)
            throw new InvalidOperationException($"duplicate system tag '{dupTag.Key}'");
    }

    private static string ValidTag(string tag)
    {
        string trimmed = tag?.Trim() ?? "";
        if (trimmed.Length == 0)
            throw new InvalidOperationException("a system tag cannot be empty");
        return trimmed;
    }
}

public sealed class SystemEntry
{
    public Guid Guid;
    public string Tag = "";
}

public sealed record TagReconciliation(
    IReadOnlyDictionary<string, Guid> Resolved,
    IReadOnlyList<string> Appeared,
    IReadOnlyList<SystemEntry> Vanished,
    IReadOnlyList<(SystemEntry From, string To)> RenameCandidates)
{
    public bool NeedsHuman => this.Appeared.Count > 0 || this.Vanished.Count > 0;
}

public static class SystemTags
{
    // Zone FRs carry human-typed tag lists ("FC-8, FC-13"). Split conservatively; suspected range
    // forms ("UH-2-4" — the project-a trap that silently meant UH-2 through UH-4) are returned
    // verbatim but flagged, so validate reports them instead of anyone guessing an expansion.
    public static (List<string> Tags, List<string> Warnings) Parse(string? raw)
    {
        var tags = new List<string>();
        var warnings = new List<string>();
        foreach (string piece in (raw ?? "").Split(',', ';'))
        {
            string tag = piece.Trim();
            if (tag.Length == 0) continue;
            tags.Add(tag);
            var parts = tag.Split('-');
            if (parts.Length >= 3 && parts.Skip(1).All(p => p.All(char.IsDigit) && p.Length > 0))
                warnings.Add($"'{tag}' looks like a range form — expand it explicitly (e.g. UH-2, UH-3, UH-4)");
        }
        return (tags, warnings);
    }
}
