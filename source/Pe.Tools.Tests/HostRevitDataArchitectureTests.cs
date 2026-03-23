using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Global.Services.Host;
using Pe.Host.Contracts;
using Pe.Host.Services;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using System.Reflection;

namespace Pe.Tools.Tests;

public sealed class HostRevitDataArchitectureTests : RevitTestBase {
    [Test]
    public async Task Http_routes_use_explicit_loaded_families_filter_endpoints() {
        var routeFieldNames = typeof(HttpRoutes).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Select(field => field.Name)
            .ToList();

        await Assert.That(HttpRoutes.LoadedFamiliesFilterSchema)
            .IsEqualTo("/api/revit-data/loaded-families/filter/schema");
        await Assert.That(HttpRoutes.LoadedFamiliesFilterFieldOptions)
            .IsEqualTo("/api/revit-data/loaded-families/filter/field-options");
        await Assert.That(routeFieldNames).Contains(nameof(HttpRoutes.LoadedFamiliesFilterSchema));
        await Assert.That(routeFieldNames).Contains(nameof(HttpRoutes.LoadedFamiliesFilterFieldOptions));
        await Assert.That(routeFieldNames).DoesNotContain("RouteSchema");
        await Assert.That(routeFieldNames).DoesNotContain("RouteFieldOptions");
    }

    [Test]
    public async Task Contracts_assembly_does_not_expose_generic_revit_route_types() {
        var contractsAssembly = typeof(HttpRoutes).Assembly;

        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.RevitDataRouteKey")).IsNull();
        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.RouteSchemaRequest")).IsNull();
        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.RouteFieldOptionsRequest")).IsNull();
        await Assert.That(contractsAssembly.GetType("Pe.Host.Contracts.LoadedFamiliesRouteFilters")).IsNull();
    }

    [Test]
    public async Task Loaded_families_filter_schema_service_generates_schema_without_module_key() {
        var service = new HostSchemaService(new HostSettingsModuleCatalog());

        var response = service.GetLoadedFamiliesFilterSchemaEnvelope();

        await Assert.That(response.Ok).IsTrue();
        await Assert.That(response.Data).IsNotNull();
        await Assert.That(response.Data!.SchemaJson).Contains("\"familyNames\"");
        await Assert.That(response.Data.SchemaJson).Contains("\"categoryNames\"");
    }

    [Test]
    public async Task Loaded_families_filter_field_options_envelope_uses_explicit_request_contract() {
        var service = new HostSchemaService(new HostSettingsModuleCatalog());

        var response = service.GetLoadedFamiliesFilterFieldOptionsEnvelope(
            new LoadedFamiliesFilterFieldOptionsRequest(
                nameof(LoadedFamiliesFilter.FamilyNames),
                SchemaDatasetIds.LoadedFamiliesCatalog,
                null
            )
        );

        await Assert.That(response.Data).IsNotNull();
        await Assert.That(response.Data!.SourceKey).IsEqualTo(SchemaDatasetIds.LoadedFamiliesCatalog);
    }

    [Test]
    public async Task Parameter_bearing_contracts_use_identity_without_duplicate_scalar_fields() {
        await AssertIdentityOnlyShape<ParameterCatalogEntry>("Name", "IsShared", "IsBuiltIn", "SharedGuid");
        await AssertIdentityOnlyShape<LoadedFamilyVisibleParameterEntry>("Name", "SharedGuid", "IsBuiltIn");
        await AssertIdentityOnlyShape<LoadedFamilyExcludedParameterEntry>("Name", "SharedGuid");
        await AssertIdentityOnlyShape<ProjectParameterBindingEntry>("Name", "SharedGuid", "IsShared", "IsBuiltIn");
    }

    [Test]
    public async Task Parameter_contract_serialization_nests_identity_and_omits_legacy_top_level_scalars() {
        var identity = new ParameterIdentity(
            "shared:11111111-1111-1111-1111-111111111111",
            ParameterIdentityKind.SharedGuid,
            "Flow",
            null,
            "11111111-1111-1111-1111-111111111111",
            null
        );
        var entry = new ParameterCatalogEntry(
            identity,
            "String",
            "autodesk.spec.aec:string.text",
            true,
            false,
            ["Family A"],
            ["Type A"]
        );

        var json = JsonConvert.SerializeObject(entry, CreateSerializerSettings());

        await Assert.That(json).Contains("\"identity\"");
        await Assert.That(json).Contains("\"name\":\"Flow\"");
        await Assert.That(json).DoesNotContain("\"isBuiltIn\":");
        await Assert.That(json).DoesNotContain("\"isShared\":");
    }

    [Test]
    public async Task Pe_Global_loaded_families_and_parameter_layers_do_not_reference_storage_runtime_schema_providers() {
        var loadedFamiliesFiles = EnumerateRepoSourceFiles("source/Pe.Global/Revit/Lib/Families/LoadedFamilies")
            .Select(File.ReadAllText)
            .ToList();
        var parameterFiles = EnumerateRepoSourceFiles("source/Pe.Global/Revit/Lib/Parameters")
            .Select(File.ReadAllText)
            .ToList();

        await Assert.That(loadedFamiliesFiles)
            .DoesNotContain(content =>
                content.Contains("using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;", StringComparison.Ordinal));
        await Assert.That(parameterFiles)
            .DoesNotContain(content =>
                content.Contains("using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;", StringComparison.Ordinal));
    }

    [Test]
    public async Task Repo_does_not_reference_deleted_route_types_or_compat_collectors() {
        var sourceFiles = EnumerateRepoSourceFiles(
                "source/Pe.Global",
                "source/Pe.Host",
                "source/Pe.Host.Contracts",
                "source/Pe.StorageRuntime.Revit",
                "source/Pe.RevitData"
            )
            .Select(File.ReadAllText)
            .ToList();

        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("LoadedFamiliesRouteFilters", StringComparison.Ordinal));
        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("RevitDataRouteKey", StringComparison.Ordinal));
        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("RouteSchemaRequest", StringComparison.Ordinal));
        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("RouteFieldOptionsRequest", StringComparison.Ordinal));
        await Assert.That(sourceFiles)
            .DoesNotContain(content => content.Contains("ProjectFamilyParameterCollector", StringComparison.Ordinal));
    }

    [Test]
    public async Task Revit_data_cache_stale_inflight_completion_does_not_recache_after_invalidation() {
        var cache = new RevitDataCacheProbe();
        var invoked = 0;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstTask = cache.GetOrCreateAsync(
            HostInvalidationDomain.LoadedFamiliesCatalog,
            "catalog-key",
            TimeSpan.FromMinutes(1),
            async () => {
                _ = Interlocked.Increment(ref invoked);
                _ = await release.Task;
                return "stale";
            }
        );
        await WaitUntilAsync(() => Volatile.Read(ref invoked) == 1);

        cache.Invalidate(HostInvalidationDomain.LoadedFamiliesCatalog);
        release.SetResult(true);
        _ = await firstTask;

        var second = await cache.GetOrCreateAsync(
            HostInvalidationDomain.LoadedFamiliesCatalog,
            "catalog-key",
            TimeSpan.FromMinutes(1),
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("fresh");
            }
        );
        var third = await cache.GetOrCreateAsync(
            HostInvalidationDomain.LoadedFamiliesCatalog,
            "catalog-key",
            TimeSpan.FromMinutes(1),
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("should-not-run");
            }
        );

        await Assert.That(second).IsEqualTo("fresh");
        await Assert.That(third).IsEqualTo("fresh");
        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(2);
    }

    [Test]
    public async Task Revit_data_cache_post_invalidation_requests_do_not_join_stale_inflight_work() {
        var cache = new RevitDataCacheProbe();
        var invoked = 0;
        var firstRelease = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstTask = cache.CoalesceAsync(
            HostInvalidationDomain.LoadedFamiliesMatrix,
            "matrix-key",
            async () => {
                _ = Interlocked.Increment(ref invoked);
                _ = await firstRelease.Task;
                return "stale";
            }
        );
        await WaitUntilAsync(() => Volatile.Read(ref invoked) == 1);

        cache.Invalidate(HostInvalidationDomain.LoadedFamiliesMatrix);

        var secondTask = cache.CoalesceAsync(
            HostInvalidationDomain.LoadedFamiliesMatrix,
            "matrix-key",
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("fresh");
            }
        );
        var second = await secondTask;

        await Assert.That(second).IsEqualTo("fresh");
        await Assert.That(firstTask.IsCompleted).IsFalse();

        firstRelease.SetResult(true);
        var first = await firstTask;

        await Assert.That(first).IsEqualTo("stale");
        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(2);
    }

    [Test]
    public async Task Revit_data_cache_global_invalidation_clears_cached_entries_and_inflight_work() {
        var cache = new RevitDataCacheProbe();
        var invoked = 0;
        var cached = await cache.GetOrCreateAsync(
            HostInvalidationDomain.ScheduleCatalog,
            "schedule-key",
            TimeSpan.FromMinutes(1),
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("cached");
            }
        );
        await Assert.That(cached).IsEqualTo("cached");

        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var inflightTask = cache.GetOrCreateAsync(
            HostInvalidationDomain.ProjectParameterBindings,
            "bindings-key",
            TimeSpan.FromMinutes(1),
            async () => {
                _ = Interlocked.Increment(ref invoked);
                _ = await release.Task;
                return "stale";
            }
        );
        await WaitUntilAsync(() => Volatile.Read(ref invoked) == 2);

        cache.Invalidate();

        var refreshedCacheValue = await cache.GetOrCreateAsync(
            HostInvalidationDomain.ScheduleCatalog,
            "schedule-key",
            TimeSpan.FromMinutes(1),
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("fresh-cache");
            }
        );
        var refreshedInflightValue = await cache.GetOrCreateAsync(
            HostInvalidationDomain.ProjectParameterBindings,
            "bindings-key",
            TimeSpan.FromMinutes(1),
            () => {
                _ = Interlocked.Increment(ref invoked);
                return Task.FromResult("fresh-inflight");
            }
        );

        release.SetResult(true);
        _ = await inflightTask;

        await Assert.That(refreshedCacheValue).IsEqualTo("fresh-cache");
        await Assert.That(refreshedInflightValue).IsEqualTo("fresh-inflight");
        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(4);
    }

    private static async Task AssertIdentityOnlyShape<TContract>(params string[] removedPropertyNames) {
        var propertyNames = typeof(TContract).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .ToList();

        await Assert.That(propertyNames).Contains(nameof(ParameterCatalogEntry.Identity));
        foreach (var removedPropertyName in removedPropertyNames)
            await Assert.That(propertyNames).DoesNotContain(removedPropertyName);
    }

    private static JsonSerializerSettings CreateSerializerSettings() {
        var settings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        };
        settings.Converters.Add(new StringEnumConverter());
        return settings;
    }

    private static IEnumerable<string> EnumerateRepoSourceFiles(params string[] relativeDirectories) =>
        relativeDirectories
            .Select(relativeDirectory =>
                Path.Combine(GetRepoRoot(), relativeDirectory.Replace('/', Path.DirectorySeparatorChar)))
            .Where(Directory.Exists)
            .SelectMany(directory => Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            .Where(path => !path.Contains("\\bin\\", StringComparison.OrdinalIgnoreCase))
            .Where(path => !path.Contains("\\obj\\", StringComparison.OrdinalIgnoreCase));

    private static string GetRepoRoot() {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null) {
            if (File.Exists(Path.Combine(current.FullName, "Pe.Tools.slnx")))
                return current.FullName;

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate repository root.");
    }

    private static async Task WaitUntilAsync(Func<bool> predicate) {
        for (var attempt = 0; attempt < 100; attempt++) {
            if (predicate())
                return;

            await Task.Delay(10);
        }

        throw new TimeoutException("Timed out waiting for test condition.");
    }

    private sealed class RevitDataCacheProbe {
        private readonly object _instance;
        private readonly MethodInfo _coalesceAsyncMethod;
        private readonly MethodInfo _getOrCreateAsyncMethod;
        private readonly MethodInfo _invalidateMethod;

        public RevitDataCacheProbe() {
            var cacheType = typeof(RequestService).Assembly.GetType("Pe.Global.Services.Host.RevitDataCache")
                            ?? throw new InvalidOperationException("RevitDataCache type was not found.");
            this._instance = Activator.CreateInstance(cacheType, true)
                             ?? throw new InvalidOperationException("RevitDataCache instance could not be created.");
            this._getOrCreateAsyncMethod = cacheType.GetMethods(BindingFlags.Instance | BindingFlags.Public)
                                           .SingleOrDefault(method =>
                                               method.Name == "GetOrCreateAsync" &&
                                               method.IsGenericMethodDefinition &&
                                               method.GetParameters().Length == 4
                                           )
                                           ?? throw new InvalidOperationException("GetOrCreateAsync was not found.");
            this._coalesceAsyncMethod = cacheType.GetMethods(BindingFlags.Instance | BindingFlags.Public)
                                        .SingleOrDefault(method =>
                                            method.Name == "CoalesceAsync" &&
                                            method.IsGenericMethodDefinition &&
                                            method.GetParameters().Length == 3
                                        )
                                        ?? throw new InvalidOperationException("CoalesceAsync was not found.");
            this._invalidateMethod = cacheType.GetMethod(
                                         "Invalidate",
                                         BindingFlags.Instance | BindingFlags.Public
                                     )
                                     ?? throw new InvalidOperationException("Invalidate was not found.");
        }

        public Task<TValue> GetOrCreateAsync<TValue>(
            HostInvalidationDomain domain,
            string key,
            TimeSpan ttl,
            Func<Task<TValue>> factory
        ) => (Task<TValue>)(this._getOrCreateAsyncMethod.MakeGenericMethod(typeof(TValue)).Invoke(
            this._instance,
            [domain, key, ttl, factory]
        ) ?? throw new InvalidOperationException("GetOrCreateAsync returned null."));

        public Task<TValue> CoalesceAsync<TValue>(
            HostInvalidationDomain domain,
            string key,
            Func<Task<TValue>> factory
        ) => (Task<TValue>)(this._coalesceAsyncMethod.MakeGenericMethod(typeof(TValue)).Invoke(
            this._instance,
            [domain, key, factory]
        ) ?? throw new InvalidOperationException("CoalesceAsync returned null."));

        public void Invalidate(params HostInvalidationDomain[] domains) =>
            _ = this._invalidateMethod.Invoke(this._instance, [domains]);
    }
}
