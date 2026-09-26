using Pe.Revit.Global.Lib.Mep;
using Pe.Revit.Scripting.Context;
using Pe.Shared.RevitData.Ducts;

/// <summary>
/// Read-only Pea script. Copy into a Pod's src directory and declare it as an entrypoint, or submit the class as scriptContent.
/// Execute with pea script execute --source-path src/DuctPressure.cs in the selected Pod and document context.
/// The default scenario leaves unknown fan/component ratings unresolved; edit Assumptions to supply design values.
/// </summary>
public sealed class DuctPressure : PeScriptContainer {
    /// <summary>Snapshot the supplied document and print each group's critical path and pressure margin without changing Revit.</summary>
    public override void Execute() {
        if (doc == null) { WriteLine("Choose a project document."); return; }
        var snapshot = DuctSnapshots.Snapshot(doc);
        var solved = DuctPressureSolver.Solve(snapshot, new Assumptions());
        foreach (var group in solved.Groups) {
            ThrowIfCancelled();
            if (group.CriticalPath is not { } path) {
                WriteLine($"{group.GroupId}: no unique root-to-terminal path; inspect the result issues.");
                continue;
            }
            var margin = group.MarginInWg is { } value ? $"{value:F3} in-wg" : "unknown (see assumptions/issues)";
            WriteLine($"{group.GroupId}: path {string.Join(" -> ", path.Path)}, duct loss {path.DuctLossInWg:F3} in-wg, margin {margin}, complete={path.IsComplete}");
        }
        Result(solved);
    }
}
