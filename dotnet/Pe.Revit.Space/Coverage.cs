using Pe.Shared.RevitData;
using System.Runtime.Serialization;
using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("Pe.Shared.Tests")]

namespace Pe.Revit.Space;

/// <summary>Stable source placement. Numeric Revit ids are payload, never exclusion identity.</summary>
public sealed record Placement(string HostDocumentKey, string? LinkUniqueId);
public sealed record SubjectExclusion(string DocumentKey, Placement Placement, string SubjectUniqueId);
public enum RevisionKind {
    [EnumMember(Value = "observed")] Observed,
    [EnumMember(Value = "unavailable")] Unavailable
}
public enum AcquisitionOutcome {
    [EnumMember(Value = "acquired")] Acquired,
    [EnumMember(Value = "empty")] Empty,
    [EnumMember(Value = "partial")] Partial,
    [EnumMember(Value = "failed")] Failed,
    [EnumMember(Value = "deferred")] Deferred,
    [EnumMember(Value = "approximate")] Approximate,
    [EnumMember(Value = "outside-scope")] OutsideScope
}
public enum AcquisitionReason {
    [EnumMember(Value = "none")] None,
    [EnumMember(Value = "geometry-read")] GeometryRead,
    [EnumMember(Value = "triangulate")] Triangulate,
    [EnumMember(Value = "budget")] Budget,
    [EnumMember(Value = "unsupported")] Unsupported
}
public enum CoverageReason {
    [EnumMember(Value = "source-unread")] SourceUnread,
    [EnumMember(Value = "partial-geometry")] PartialGeometry,
    [EnumMember(Value = "failed-geometry")] FailedGeometry,
    [EnumMember(Value = "deferred")] Deferred,
    [EnumMember(Value = "approximate")] Approximate
}
public enum RevisionUnavailableReason {
    [EnumMember(Value = "not-recorded")] NotRecorded,
    [EnumMember(Value = "source-unread")] SourceUnread
}
public sealed record SourceRevision(RevisionKind Kind, long? Epoch, string? Version, RevisionUnavailableReason? Reason);
public sealed record SourceObservation(Placement Placement, string? DocumentKey, SourceRevision Revision,
    IReadOnlyList<double> ToHost, SceneSourceState Availability);
public sealed record Acquisition(Placement Placement, string SubjectUniqueId, AcquisitionOutcome Outcome, AcquisitionReason Reason);
public sealed record CoverageGap(Placement Placement, string? SubjectUniqueId, CoverageReason Reason, int Count);

/// <summary>Observed basis and acquisition, never a claim that a retained answer is current.</summary>
public sealed record SpatialEvidence(string DocumentKey, long? Revision, DateTime ObservedAt, string Frame,
    Resolved Resolved, IReadOnlyList<SourceObservation> Sources, IReadOnlyList<Acquisition> Acquisition,
    IReadOnlyList<CoverageGap> Coverage) : IObserved {
    public const string HostInternalFt = "host-internal-ft";
    public GeometryCost? GeometryCost { get; init; }

    public bool SameSources(SpatialEvidence other) => this.Sources.Count == other.Sources.Count
        && this.Sources.All(s => other.Sources.Any(o => o.Placement == s.Placement && o.DocumentKey == s.DocumentKey
            && o.Revision == s.Revision && o.Availability == s.Availability && o.ToHost.SequenceEqual(s.ToHost)));

    /// <summary>Refuse absent or corrupt basis before it can authorize a retained native measurement.</summary>
    public void RequireBasis(string documentKey, long revision) {
        if (this.DocumentKey != documentKey || this.Revision != revision || this.ObservedAt == default
            || this.Frame != HostInternalFt || !this.Resolved.AcquisitionRequested || this.Sources.Count == 0
            || this.Sources.Select(s => s.Placement).Distinct().Count() != this.Sources.Count
            || !this.Sources.Any(s => s.Placement.LinkUniqueId is null && s.DocumentKey == documentKey
                && s.Revision.Epoch == revision && s.Availability == SceneSourceState.Loaded)
            || this.Sources.Any(s => s.Placement.HostDocumentKey != documentKey
                || s.ToHost.Count != 16 || s.ToHost.Any(v => double.IsNaN(v) || double.IsInfinity(v))
                || s.Availability == SceneSourceState.Loaded && (s.DocumentKey is null || s.Revision.Kind != RevisionKind.Observed || s.Revision.Epoch is null))
            || this.Acquisition.Any(a => string.IsNullOrEmpty(a.SubjectUniqueId) || !this.Sources.Any(s => s.Placement == a.Placement))
            || this.Coverage.Any(g => g.Count < 1 || !this.Sources.Any(s => s.Placement == g.Placement)))
            throw new InvalidOperationException("Space evidence has no matching observed document basis.");
    }
}

/// <summary>Full scene evidence lives in PSC1. Both RPC evidence projections carry only these fixed counts and its reference.</summary>
public sealed record SceneEvidence(string DocumentKey, long? Revision, DateTime ObservedAt, string Frame,
    SceneEvidenceSummary Summary, SceneArtifactReference Artifact) : IObserved {
    public static SceneEvidence From(SpatialEvidence evidence, SceneArtifactReference artifact) => new(
        evidence.DocumentKey, evidence.Revision, evidence.ObservedAt, evidence.Frame,
        new SceneEvidenceSummary(evidence.Resolved.AcquisitionRequested, evidence.Resolved.Representation,
            new SceneSourceCounts(
                evidence.Sources.Count(s => s.Availability == SceneSourceState.Loaded),
                evidence.Sources.Count(s => s.Availability == SceneSourceState.Unloaded),
                evidence.Sources.Count(s => s.Availability == SceneSourceState.Unavailable)),
            new SceneAcquisitionCounts(
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Acquired),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Empty),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Partial),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Failed),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Deferred),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.Approximate),
                evidence.Acquisition.Count(a => a.Outcome == AcquisitionOutcome.OutsideScope)),
            new SceneCoverageCounts(
                evidence.Coverage.Where(g => g.Reason == CoverageReason.SourceUnread).Sum(g => g.Count),
                evidence.Coverage.Where(g => g.Reason == CoverageReason.PartialGeometry).Sum(g => g.Count),
                evidence.Coverage.Where(g => g.Reason == CoverageReason.FailedGeometry).Sum(g => g.Count),
                evidence.Coverage.Where(g => g.Reason == CoverageReason.Deferred).Sum(g => g.Count),
                evidence.Coverage.Where(g => g.Reason == CoverageReason.Approximate).Sum(g => g.Count))), artifact);
}
public sealed record SceneArtifactReference(string Id, string Url, long Bytes);
public sealed record SceneEvidenceSummary(bool AcquisitionRequested, string Representation,
    SceneSourceCounts Sources, SceneAcquisitionCounts Acquisition, SceneCoverageCounts Coverage);
public sealed record SceneSourceCounts(int Loaded, int Unloaded, int Unavailable);
public sealed record SceneAcquisitionCounts(int Acquired, int Empty, int Partial, int Failed, int Deferred, int Approximate, int OutsideScope);
public sealed record SceneCoverageCounts(int SourceUnread, int PartialGeometry, int FailedGeometry, int Deferred, int Approximate);

internal sealed class GeometryRead {
    internal bool Failed;
    internal bool Outside;
    internal AcquisitionReason Reason;
    internal Acquisition Finish(Placement placement, string uniqueId, int rows) => new(placement, uniqueId,
        this.Failed ? rows > 0 ? AcquisitionOutcome.Partial : AcquisitionOutcome.Failed
            : rows > 0 ? AcquisitionOutcome.Acquired : this.Outside ? AcquisitionOutcome.OutsideScope : AcquisitionOutcome.Empty,
        this.Failed ? this.Reason : AcquisitionReason.None);
}
