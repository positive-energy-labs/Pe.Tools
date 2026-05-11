namespace Build;

public sealed record BuildProjectIdentity(
    string ProjectName,
    ModuleClass ModuleClass,
    ProductClass ProductClass,
    bool IsRevitAware,
    bool SupportsRevitYear,
    string TargetFrameworkClass,
    IReadOnlyList<VerifyTarget> VerifyTargets
) {
    public bool SupportsAttachedRrd => this.VerifyTargets.Contains(VerifyTarget.AttachedRrd);

    public bool SupportsFreshRevitProcess => this.VerifyTargets.Contains(VerifyTarget.FreshRevitProcess);
}
