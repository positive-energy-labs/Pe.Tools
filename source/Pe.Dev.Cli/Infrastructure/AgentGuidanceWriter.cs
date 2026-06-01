namespace Pe.Dev.Cli;

internal static class AgentGuidanceWriter {
    public static void Write(TextWriter writer, string summary, params string[] guidanceLines) {
        writer.WriteLine("AGENT GUIDANCE:");
        writer.WriteLine(summary);
        foreach (var line in guidanceLines.Where(line => !string.IsNullOrWhiteSpace(line)))
            writer.WriteLine(line);
    }

    public static void WriteFreshOwnedLane(TextWriter writer, int revitYear) =>
        Write(
            writer,
            $"FreshOwnedRevit/FreshRevitProcess verification selected Revit {revitYear}. pe-dev owns the launched process and will close it after the run.",
            "Use this lane for proof-grade runtime verification when RRD freshness is uncertain or HR is unsafe.",
            "Use AttachedRrd scripting instead when the current live document/UI session is the thing being investigated."
        );
}
