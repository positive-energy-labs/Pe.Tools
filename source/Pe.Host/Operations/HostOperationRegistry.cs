using Pe.Shared.ApsAuth;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime;
using Microsoft.Win32;

namespace Pe.Host.Operations;

internal sealed class HostOperationRegistry {
    private readonly IReadOnlyDictionary<string, IHostOperation> _operationsByKey;

    public HostOperationRegistry() {
        IHostOperation[] localOperations = [
            HostOperations.Create<ApsTokenRequest>(
                GetApsAuthStatusOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.GetStatus(request)))
            ),
            HostOperations.Create<ApsTokenRequest>(
                LoginApsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.Login(request)))
            ),
            HostOperations.Create<NoRequest>(
                LogoutApsOperationContract.Definition,
                static (request, context, cancellationToken) => {
                    context.ApsAuthService.Logout();
                    return Task.FromResult(HostOperations.Local(new ApsLogoutResult(true)));
                }
            ),
            HostOperations.Create<ApsTokenRequest>(
                AcquireApsAccessTokenOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(context.ApsAuthService.AcquireAccessToken(request)))
            ),
            HostOperations.Create<NoRequest>(
                GetHostProbeOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostProbeData(context)))
            ),
            HostOperations.Create<NoRequest>(
                GetHostSessionSummaryOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostSessionSummaryData(context)))
            ),
            HostOperations.Create<HostLogsRequest>(
                GetHostLogsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateHostLogsData(request)))
            ),
            HostOperations.Create<RevitRecentDocumentsRequest>(
                GetRevitRecentDocumentsOperationContract.Definition,
                static (request, context, cancellationToken) =>
                    Task.FromResult(HostOperations.Local(CreateRevitRecentDocumentsData(request)))
            ),
            HostOperations.Create<GetSettingsWorkspacesRequest>(
                GetWorkspacesOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.GetWorkspacesAsync(request, cancellationToken))
            ),
            HostOperations.Create<SettingsTreeRequest>(
                DiscoverSettingsTreeOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.DiscoverAsync(request, cancellationToken))
            ),
            HostOperations.Create<OpenSettingsDocumentRequest>(
                OpenSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.OpenAsync(request, cancellationToken))
            ),
            HostOperations.Create<ValidateSettingsDocumentRequest>(
                ValidateSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.ValidateAsync(request, cancellationToken))
            ),
            HostOperations.Create<SaveSettingsDocumentRequest>(
                SaveSettingsDocumentOperationContract.Definition,
                static async (request, context, cancellationToken) =>
                    HostOperations.Local(await context.StorageService.SaveAsync(request, cancellationToken))
            )
        ];

        this.Operations = [
            .. localOperations,
            .. HostOperationsCatalog.Bridge.Select(definition => HostOperations.Bridge(definition))
        ];

        ValidateDefinitions(this.Operations);
        this._operationsByKey = this.Operations.ToDictionary(
            operation => operation.Definition.Key,
            StringComparer.Ordinal
        );
    }

    public IReadOnlyList<IHostOperation> Operations { get; }

    public bool TryGetByKey(string key, out IHostOperation operation) =>
        this._operationsByKey.TryGetValue(key, out operation!);

    private static HostLogsData CreateHostLogsData(HostLogsRequest request) {
        if (request.TailLineCount <= 0)
            throw new ArgumentOutOfRangeException(nameof(request), "TailLineCount must be greater than zero.");

        var logs = ProductRuntimeLayout.ForCurrentUser().Logs;
        HostLogFileData[] files = request.Target switch {
            HostLogTarget.Host => [CreateHostLogFile("host", logs.HostLogPath, request.TailLineCount)],
            HostLogTarget.Revit => [CreateHostLogFile("revit", logs.RevitAppLogPath, request.TailLineCount)],
            HostLogTarget.All => [
                CreateHostLogFile("host", logs.HostLogPath, request.TailLineCount),
                CreateHostLogFile("revit", logs.RevitAppLogPath, request.TailLineCount)
            ],
            _ => throw new InvalidOperationException($"Unsupported log target '{request.Target}'.")
        };

        return new HostLogsData(files);
    }

    private static HostLogFileData CreateHostLogFile(string label, string filePath, int tailLineCount) {
        var lines = File.Exists(filePath)
            ? File.ReadAllLines(filePath)
            : [];
        var startIndex = Math.Max(0, lines.Length - tailLineCount);
        return new HostLogFileData(label, filePath, [.. lines.Skip(startIndex)]);
    }

    private static RevitRecentDocumentsData CreateRevitRecentDocumentsData(RevitRecentDocumentsRequest request) {
        var documents = CollectRecentDocumentsFromRevitIni(request).ToList();
        if (request.IncludeRegistryMru)
            documents.AddRange(CollectRecentDocumentsFromRegistryProfiles(request));

        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return new RevitRecentDocumentsData([
            .. documents
                .Where(entry => !request.LocalFilesOnly || entry.PathKind == RevitRecentDocumentPathKind.LocalPath)
                .Where(entry => entry.PathKind != RevitRecentDocumentPathKind.LocalPath || !entry.Exists.HasValue || entry.Exists.Value)
                .Where(entry => seenPaths.Add(entry.Path))
        ]);
    }

    private static IEnumerable<RevitRecentDocumentEntry> CollectRecentDocumentsFromRevitIni(RevitRecentDocumentsRequest request) {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (string.IsNullOrWhiteSpace(appData))
            return [];

        var revitRoot = Path.Combine(appData, "Autodesk", "Revit");
        if (!Directory.Exists(revitRoot))
            return [];

        return Directory
            .EnumerateDirectories(revitRoot, "Autodesk Revit *", SearchOption.TopDirectoryOnly)
            .Select(directory => new { Directory = directory, RevitYear = GetRevitYearFromDirectoryName(Path.GetFileName(directory)) })
            .Where(item => item.RevitYear != null && MatchesRequestedRevitYear(item.RevitYear, request.RevitYear))
            .SelectMany(item => CollectRecentDocumentsFromRevitIniFile(item.Directory, item.RevitYear!));
    }

    private static IEnumerable<RevitRecentDocumentEntry> CollectRecentDocumentsFromRevitIniFile(string directory, string revitYear) {
        var revitIniPath = Path.Combine(directory, "Revit.ini");
        if (!File.Exists(revitIniPath))
            return [];

        var entries = new List<RevitRecentDocumentEntry>();
        var inRecentFileList = false;
        foreach (var line in File.ReadLines(revitIniPath)) {
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
                continue;

            if (trimmed.StartsWith("[", StringComparison.Ordinal) && trimmed.EndsWith("]", StringComparison.Ordinal)) {
                inRecentFileList = string.Equals(trimmed, "[Recent File List]", StringComparison.OrdinalIgnoreCase);
                continue;
            }

            if (!inRecentFileList)
                continue;

            var separatorIndex = trimmed.IndexOf('=');
            if (separatorIndex <= 0)
                continue;

            var key = trimmed[..separatorIndex];
            if (!key.StartsWith("File", StringComparison.OrdinalIgnoreCase))
                continue;

            var path = trimmed[(separatorIndex + 1)..].Trim();
            if (string.IsNullOrWhiteSpace(path))
                continue;

            entries.Add(CreateRecentDocumentEntry(
                RevitRecentDocumentSource.RevitIni,
                revitYear,
                TryParseRank(key),
                path,
                profile: null
            ));
        }

        return entries.OrderBy(entry => entry.Rank ?? int.MaxValue);
    }

    private static IEnumerable<RevitRecentDocumentEntry> CollectRecentDocumentsFromRegistryProfiles(RevitRecentDocumentsRequest request) {
        var baseKey = Registry.CurrentUser.OpenSubKey(@"Software\Autodesk\Revit");
        if (baseKey == null)
            return [];

        return baseKey
            .GetSubKeyNames()
            .Select(name => new { Name = name, RevitYear = GetRevitYearFromDirectoryName(name) })
            .Where(item => item.RevitYear != null && MatchesRequestedRevitYear(item.RevitYear, request.RevitYear))
            .SelectMany(item => CollectRecentDocumentsFromRegistryVersion(baseKey, item.Name, item.RevitYear!));
    }

    private static IEnumerable<RevitRecentDocumentEntry> CollectRecentDocumentsFromRegistryVersion(RegistryKey baseKey, string versionKeyName, string revitYear) {
        using var profilesKey = baseKey.OpenSubKey($@"{versionKeyName}\Profiles");
        if (profilesKey == null)
            return [];

        var entries = new List<RevitRecentDocumentEntry>();
        foreach (var profileName in profilesKey.GetSubKeyNames()) {
            using var profileKey = profilesKey.OpenSubKey(profileName);
            if (profileKey == null)
                continue;

            foreach (var valueName in profileKey.GetValueNames().Where(name => name.StartsWith("FileNameMRU", StringComparison.OrdinalIgnoreCase))) {
                if (profileKey.GetValue(valueName) is not string path || string.IsNullOrWhiteSpace(path))
                    continue;

                entries.Add(CreateRecentDocumentEntry(
                    RevitRecentDocumentSource.RegistryProfileMru,
                    revitYear,
                    TryParseRank(valueName),
                    path,
                    profileName
                ));
            }
        }

        return entries.OrderBy(entry => entry.Profile, StringComparer.Ordinal).ThenBy(entry => entry.Rank ?? int.MaxValue);
    }

    private static RevitRecentDocumentEntry CreateRecentDocumentEntry(
        RevitRecentDocumentSource source,
        string revitYear,
        int? rank,
        string path,
        string? profile
    ) {
        var pathKind = GetRecentDocumentPathKind(path);
        return new RevitRecentDocumentEntry(
            source,
            revitYear,
            rank,
            path,
            pathKind,
            GetRecentDocumentTitle(path, pathKind),
            pathKind == RevitRecentDocumentPathKind.LocalPath ? File.Exists(path) : null,
            profile
        );
    }

    private static RevitRecentDocumentPathKind GetRecentDocumentPathKind(string path) {
        if (path.StartsWith("cld://", StringComparison.OrdinalIgnoreCase))
            return RevitRecentDocumentPathKind.CloudPath;

        return Path.IsPathFullyQualified(path)
            ? RevitRecentDocumentPathKind.LocalPath
            : RevitRecentDocumentPathKind.Unknown;
    }

    private static string GetRecentDocumentTitle(string path, RevitRecentDocumentPathKind pathKind) {
        if (pathKind == RevitRecentDocumentPathKind.LocalPath)
            return Path.GetFileName(path);

        var slashIndex = path.LastIndexOf('/');
        var backslashIndex = path.LastIndexOf('\\');
        var separatorIndex = Math.Max(slashIndex, backslashIndex);
        return Uri.UnescapeDataString(separatorIndex >= 0 ? path[(separatorIndex + 1)..] : path);
    }

    private static string? GetRevitYearFromDirectoryName(string name) {
        var match = System.Text.RegularExpressions.Regex.Match(name, @"20\d{2}");
        return match.Success ? match.Value : null;
    }

    private static bool MatchesRequestedRevitYear(string revitYear, string? requestedRevitYear) =>
        string.IsNullOrWhiteSpace(requestedRevitYear)
        || string.Equals(requestedRevitYear, "all", StringComparison.OrdinalIgnoreCase)
        || string.Equals(revitYear, requestedRevitYear, StringComparison.OrdinalIgnoreCase);

    private static int? TryParseRank(string key) {
        var digits = new string(key.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, out var rank) ? rank : null;
    }

    private static void ValidateDefinitions(IReadOnlyList<IHostOperation> operations) {
        var definitionKeys = operations.Select(operation => operation.Definition.Key).ToHashSet(StringComparer.Ordinal);
        var missingSharedDefinitions = HostOperationsCatalog.All
            .Where(definition => !definitionKeys.Contains(definition.Key))
            .Select(definition => definition.Key)
            .ToList();
        if (missingSharedDefinitions.Count != 0) {
            throw new InvalidOperationException(
                $"Host operation registry is missing shared host operations: {string.Join(", ", missingSharedDefinitions)}"
            );
        }

        var extraDefinitions = operations
            .Where(operation => !HostOperationsCatalog.All.Any(definition =>
                string.Equals(definition.Key, operation.Definition.Key, StringComparison.Ordinal)))
            .Select(operation => operation.Definition.Key)
            .ToList();
        if (extraDefinitions.Count != 0) {
            throw new InvalidOperationException(
                $"Host operation registry contains operations missing from the shared catalog: {string.Join(", ", extraDefinitions)}"
            );
        }

        var duplicateKeys = operations
            .GroupBy(operation => operation.Definition.Key, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateKeys.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate host operation keys detected: {string.Join(", ", duplicateKeys)}"
            );
        }

        var duplicateRoutes = operations
            .Where(operation => operation.Definition.IsPublicHttp)
            .GroupBy(operation => $"{operation.Definition.Verb}:{operation.Definition.Route}", StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();
        if (duplicateRoutes.Count != 0) {
            throw new InvalidOperationException(
                $"Duplicate host operation routes detected: {string.Join(", ", duplicateRoutes)}"
            );
        }
    }

    private static HostProbeData CreateHostProbeData(HostOperationContext context) {
        var snapshot = context.BridgeServer.GetSnapshot();
        return new HostProbeData(
            HostProcessIdentity.RuntimeIdentity,
            HostProtocol.ContractVersion,
            BridgeProtocol.ContractVersion,
            snapshot.BridgePath,
            snapshot.BridgeIsConnected,
            snapshot.DisconnectReason
        );
    }

    private static HostSessionSummaryData CreateHostSessionSummaryData(HostOperationContext context) {
        var snapshot = context.BridgeServer.GetSnapshot();
        var connectedSession = snapshot.ConnectedSession;
        return new HostSessionSummaryData(
            snapshot.BridgeIsConnected,
            connectedSession?.SessionId,
            connectedSession?.ProcessId,
            connectedSession?.RevitVersion,
            connectedSession?.RuntimeFramework,
            connectedSession?.OpenDocumentCount ?? 0,
            connectedSession == null
                ? null
                : new HostActiveDocumentSummary(
                    connectedSession.ActiveDocumentTitle,
                    connectedSession.ActiveDocumentKey,
                    connectedSession.ActiveDocumentPath,
                    connectedSession.ActiveDocumentIsFamilyDocument,
                    connectedSession.ActiveDocumentIsWorkshared,
                    connectedSession.ActiveDocumentIsModelInCloud,
                    connectedSession.ActiveDocumentCloudProjectGuid,
                    connectedSession.ActiveDocumentCloudModelGuid,
                    connectedSession.ActiveDocumentCloudModelUrn,
                    connectedSession.ActiveDocumentObservedAtUnixMs
                ),
            connectedSession?.RuntimeAssemblies ?? [],
            connectedSession?.AvailableModules ?? [],
            CreateWorkbenchResourcesData(connectedSession?.State.SharedParametersFilename)
        );
    }

    private static HostWorkbenchResourcesData CreateWorkbenchResourcesData(string? sharedParametersFilename) {
        var globalState = StorageClient.Default.Global().State();
        var globalStateDirectoryPath = globalState.DirectoryPath;
        var cacheBasePath = Path.Combine(globalStateDirectoryPath, "parameters-service-cache");
        return new HostWorkbenchResourcesData(
            new HostParameterResourceData(
                globalStateDirectoryPath,
                [
                    CreateFileState("parameters-service-cache.json", globalState.ResolveSafeRelativeJsonPath("parameters-service-cache"), "StorageClient.Default.Global().State().Json(\"parameters-service-cache\")"),
                    CreateFileState("parameters-service-cache.md", cacheBasePath + ".md", "CmdCacheParametersService.WriteAdditionalFormats"),
                    CreateFileState("parameters-service-cache.csv", cacheBasePath + ".csv", "CmdCacheParametersService.WriteAdditionalFormats"),
                    CreateFileState("parameters-service-cache.toon", cacheBasePath + ".toon", "CmdCacheParametersService.WriteAdditionalFormats")
                ],
                CreateSharedParametersFileState(sharedParametersFilename)
            )
        );
    }

    private static HostResourceFileStateData CreateSharedParametersFileState(string? sharedParametersFilename) {
        if (string.IsNullOrWhiteSpace(sharedParametersFilename))
            return new HostResourceFileStateData(
                "shared-parameters.txt",
                null,
                false,
                null,
                null,
                "Autodesk.Revit.ApplicationServices.Application.SharedParametersFilename",
                "No Revit shared-parameter filename is reported for the connected bridge session."
            );

        return CreateFileState(
            "shared-parameters.txt",
            sharedParametersFilename,
            "Autodesk.Revit.ApplicationServices.Application.SharedParametersFilename"
        );
    }

    private static HostResourceFileStateData CreateFileState(string label, string filePath, string provenance) {
        var file = new FileInfo(filePath);
        return new HostResourceFileStateData(
            label,
            file.FullName,
            file.Exists,
            file.Exists ? new DateTimeOffset(file.LastWriteTimeUtc).ToUnixTimeMilliseconds() : null,
            file.Exists ? file.Length : null,
            provenance
        );
    }
}
