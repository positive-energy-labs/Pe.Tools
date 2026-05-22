namespace Pe.Dev.Cli;

internal static class AgentGuidanceWriter {
    public static void Write(TextWriter writer, string summary, params string[] guidanceLines) {
        writer.WriteLine("AGENT GUIDANCE:");
        writer.WriteLine(summary);
        foreach (var line in guidanceLines.Where(line => !string.IsNullOrWhiteSpace(line)))
            writer.WriteLine(line);
    }

    public static void WriteAttachedRrdScriptingPrimary(TextWriter writer) =>
        Write(
            writer,
            "AttachedRrd is the primary interactive Revit lane. Use it for live-document scripting and UI/session probes after an explicit runtime sync.",
            "Remember to run `pe-dev sync` before `pea script ...` or attached `.Tests` when runtime code changed; an isolated dotnet build is not runtime freshness proof.",
            "Interpret attached results as current-session evidence, not process-fresh proof.",
            "If behavior is surprising, suspect assembly freshness before chasing source changes; ask the user to restart RRD or switch to fresh owned verification."
        );

    public static void WriteHotReloadUnproven(TextWriter writer) =>
        Write(
            writer,
            "Rider reload/apply automation completed through the PeHotReloadSignal file, but pe-dev could not collect comparable loaded-runtime fingerprints or Rider's final apply result.",
            "Proceed with attached scripting/tests only for exploratory work, and treat Rider ENC/restart-required messages as authoritative.",
            "For proof-grade verification after unexpected results, restart RRD or run `pe-dev test ...`."
        );

    public static void WriteHotReloadFingerprintUnchanged(TextWriter writer) =>
        Write(
            writer,
            "The pre/post RRD Hot Reload fingerprints for loaded Pe/Toon assemblies matched.",
            "This can mean either no runtime assembly change was needed or Rider Hot Reload did not apply expected changes.",
            "If attached scripts/tests are unexpected, suspect assembly freshness first and defer to the user or run `pe-dev test ...`."
        );

    public static void WriteHotReloadFingerprintChanged(TextWriter writer) =>
        Write(
            writer,
            "The pre/post RRD Hot Reload fingerprints for loaded Pe/Toon assemblies changed.",
            "This is evidence that the attached runtime state moved, but it is not yet a complete expected-vs-loaded freshness proof.",
            "Proceed with attached scripting/tests; use fresh owned verification if results still look stale."
        );

    public static void WriteRuntimeAssembliesMatchDisk(TextWriter writer) =>
        Write(
            writer,
            "Loaded Pe/Toon assemblies match their current on-disk outputs by MVID/version.",
            "This is good AttachedRrd freshness evidence for the loaded assembly graph.",
            "It still does not prove Revit process freshness for non-hot-reloadable member-shape edits; use fresh owned verification when needed."
        );

    public static void WriteRuntimeAssembliesStale(TextWriter writer, int staleCount) =>
        Write(
            writer,
            $"Loaded Pe/Toon runtime graph has {staleCount} stale or unreadable assembly match(es) compared with current on-disk outputs.",
            "Attached scripts/tests may be running old code. Treat unexpected results as a freshness problem first.",
            "Recommended next step: rerun `pe-dev sync`; it opens PeHotReloadSignal in Rider, runs Reload All from Disk, then Apply Changes. If stale assemblies remain, ask for RRD restart or use `pe-dev test ...`."
        );

    public static void WriteAttachedPreflightPassed(TextWriter writer, int revitYear) =>
        Write(
            writer,
            $"AttachedRrd preflight passed for Revit {revitYear}: host, bridge, and visible process are available.",
            "This proves attachment, not runtime freshness.",
            "Remember to run `pe-dev sync` before `pea script ...` or attached `.Tests` when runtime code changed; an isolated dotnet build is not runtime freshness proof."
        );

    public static void WriteAttachedPreflightFailed(TextWriter writer, int revitYear, string reason) =>
        Write(
            writer,
            $"AttachedRrd preflight failed for Revit {revitYear}: {reason}",
            "Attached scripts/tests may run against no session, the wrong session, or stale loaded assemblies.",
            "Recommended next step: start the matching Rider-driven RRD session, run `pe-dev sync`, then retry.",
            "If current document state does not matter, use `pe-dev test ...` for deterministic verification."
        );

    public static void WriteFreshOwnedLane(TextWriter writer, int revitYear) =>
        Write(
            writer,
            $"FreshOwnedRevit verification selected Revit {revitYear}. pe-dev owns the launched process and will close it after the run.",
            "Use this lane for proof-grade runtime verification when RRD freshness is uncertain or HR is unsafe.",
            "Use AttachedRrd scripting instead when the current live document/UI session is the thing being investigated."
        );
}
