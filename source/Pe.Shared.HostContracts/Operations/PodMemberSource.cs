namespace Pe.Shared.HostContracts.Operations;

/// <summary>The saved pod member an apply ran from: manifest id, pod-relative path, SHA-256 of the saved bytes.</summary>
public sealed record PodMemberSource(string Pod, string Path, string Sha256);
