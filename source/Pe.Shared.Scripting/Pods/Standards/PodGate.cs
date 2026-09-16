namespace Pe.Shared.Scripting.Pods.Standards;

/// <summary>Verdict 11: the build is deterministic. Anything needing a network or a live document is not a build check.</summary>
public enum PodGateLane {
    /// <summary>Host, no Revit, no network. Hard fail at build.</summary>
    Deterministic,

    /// <summary>Needs the network. Warning at build, hard fail at run (verdict 11 / gate table row 7).</summary>
    Online,

    /// <summary>Needs a live document. Never a build check.</summary>
    Runtime
}

public enum PodGateSeverity {
    Error,
    Warning
}

/// <summary>Verdict 12: every gate emits a reason a human and an agent can act on.</summary>
/// <param name="GateId">Stable machine id, so an agent can suppress or explain one gate.</param>
/// <param name="Subject">What failed: a pod-relative path, a reference, or an id.</param>
/// <param name="Reason">One sentence naming the violated rule and the repair.</param>
public sealed record PodGateFinding(
    string GateId,
    PodGateLane Lane,
    PodGateSeverity Severity,
    string Subject,
    string Reason
) {
    public override string ToString() => $"[{this.Severity.ToString().ToLowerInvariant()}] {this.GateId} {this.Subject}: {this.Reason}";
}

/// <summary>
///     A gate is data plus one fold. Adding a check is adding a list entry in
///     <see cref="PodGateCatalog" />, never a branch in a runner.
/// </summary>
public interface IPodGate {
    string Id { get; }
    PodGateLane Lane { get; }

    /// <summary>The rule in one line, for `pea pod gates` and for an agent reading the catalog.</summary>
    string Rule { get; }

    IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject);
}

/// <summary>Convenience base so a gate body only yields (id, subject, reason).</summary>
public abstract class PodGate : IPodGate {
    public abstract string Id { get; }
    public abstract PodGateLane Lane { get; }
    public abstract string Rule { get; }

    public abstract IEnumerable<PodGateFinding> Inspect(PodBuildSubject subject);

    protected PodGateFinding Error(string subject, string reason) =>
        new(this.Id, this.Lane, PodGateSeverity.Error, subject, reason);

    protected PodGateFinding Warn(string subject, string reason) =>
        new(this.Id, this.Lane, PodGateSeverity.Warning, subject, reason);
}

public sealed record PodBuildReport(IReadOnlyList<PodGateFinding> Findings) {
    public bool Passed => this.Findings.All(f => f.Severity != PodGateSeverity.Error);

    public IEnumerable<PodGateFinding> Errors => this.Findings.Where(f => f.Severity == PodGateSeverity.Error);
}

public static class PodGateRunner {
    /// <summary>
    ///     Runs every gate whose lane is enabled. Online gates downgrade to warnings when the
    ///     build is offline; they never silently pass, because the same rule is re-checked at run.
    /// </summary>
    public static PodBuildReport Run(PodBuildSubject subject, IReadOnlyList<IPodGate> gates, bool online) {
        var findings = new List<PodGateFinding>();
        foreach (var gate in gates) {
            if (gate.Lane == PodGateLane.Runtime)
                continue;
            if (gate.Lane == PodGateLane.Online && !online) {
                findings.Add(new PodGateFinding(
                    gate.Id,
                    gate.Lane,
                    PodGateSeverity.Warning,
                    subject.Header.Id.Value,
                    $"{gate.Rule} was not checked: the build ran offline. This is re-checked at run and fails hard there."
                ));
                continue;
            }

            findings.AddRange(gate.Inspect(subject));
        }

        return new PodBuildReport(findings);
    }
}
