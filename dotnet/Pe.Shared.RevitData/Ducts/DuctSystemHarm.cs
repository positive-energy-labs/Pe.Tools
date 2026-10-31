namespace Pe.Shared.RevitData.Ducts;

/// <summary>
///     What a heal did to Revit's own calculation of the system it touched, as one refusal reason or null. A heal that
///     leaves a system it found well connected not well connected, or adds a 0 cfm section, cut the air's way: a cap on
///     the open end a fan discharges through (Chadds EX 1, 11620957:1, 444 cfm out; ducts LEDGER 2026-10-30).
/// </summary>
public static class DuctSystemHarm {
    public static string? Of(DuctSystem before, DuctSystem after) {
        var harms = new List<string>();
        if (before.IsWellConnected == true && after.IsWellConnected == false) harms.Add("not well connected");
        var dead = after.Sections.Where(Zero).Select(s => s.Number).ToList();
        if (dead.Count > before.Sections.Count(Zero))
            harms.Add($"0 cfm section {string.Join(", ", dead)}");
        return harms.Count == 0 ? null : $"would leave {after.Name} with no way for its air: {string.Join("; ", harms)}";
    }

    private static bool Zero(DuctSection s) => s.FlowCfm is { } q && q <= 0;
}
