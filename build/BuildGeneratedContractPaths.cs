namespace Build;

internal static class BuildGeneratedContractPaths {
    public const string GeneratedDirectoryPath = "build/generated";
    public const string MatrixConfigurationFilePath = GeneratedDirectoryPath + "/BuildMatrix.Configuration.props";
    public const string MatrixTargetFrameworkFilePath = GeneratedDirectoryPath + "/BuildMatrix.TargetFramework.props";
    public const string PackagePolicyFilePath = GeneratedDirectoryPath + "/PackagePolicy.props";
    public const string TaxonomyEvaluatorFilePath = GeneratedDirectoryPath + "/BuildTaxonomy.Evaluator.props";
    public const string TaxonomyValidationTargetsFilePath = GeneratedDirectoryPath + "/BuildTaxonomy.Validation.targets";
    public const string ProductLayoutFilePath = GeneratedDirectoryPath + "/ProductLayout.props";
}
