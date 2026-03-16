using Pe.Host;
using Pe.Host.Contracts;
using Pe.Host.Hubs;
using Pe.Host.Services;

HostRevitAssemblyResolver.EnsureRegistered();

var builder = WebApplication.CreateBuilder(args);
var options = BridgeHostOptions.FromEnvironment();

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddSingleton<IHostBridgeCapabilityService, HostBridgeCapabilityService>();
builder.Services.AddSingleton<IHostSettingsModuleCatalog>(sp =>
    new HostSettingsModuleCatalog(sp.GetRequiredService<IHostBridgeCapabilityService>()));
builder.Services.AddSingleton<HostSettingsRuntimeStateService>();
builder.Services.AddSingleton<HostSettingsEditorService>();
builder.Services.AddSingleton(sp => new HostSettingsStorageService(
    sp.GetRequiredService<IHostSettingsModuleCatalog>(),
    sp.GetRequiredService<IHostBridgeCapabilityService>()));
builder.Services.AddHostedService(sp => sp.GetRequiredService<BridgeServer>());

builder.Services
    .AddSignalR(signalROptions => {
        signalROptions.EnableDetailedErrors = true;
        signalROptions.MaximumReceiveMessageSize = 1024 * 1024;
    })
    .AddNewtonsoftJsonProtocol(protocolOptions => {
        var settings = HostJson.CreateSerializerSettings();
        protocolOptions.PayloadSerializerSettings.NullValueHandling = settings.NullValueHandling;
        protocolOptions.PayloadSerializerSettings.ContractResolver = settings.ContractResolver;
        foreach (var converter in settings.Converters)
            protocolOptions.PayloadSerializerSettings.Converters.Add(converter);
    });

builder.Services.AddCors(corsOptions => corsOptions.AddDefaultPolicy(policy => policy
    .WithOrigins(options.AllowedOrigins.ToArray())
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseCors();
app.MapGet(HttpRoutes.Workspaces, (
    HostSettingsStorageService storageService
) => storageService.GetWorkspaces());
app.MapGet(HttpRoutes.Tree, async (
    string moduleKey,
    string rootKey,
    string? subDirectory,
    bool recursive,
    bool includeFragments,
    bool includeSchemas,
    HostSettingsStorageService storageService,
    CancellationToken cancellationToken
) => await storageService.DiscoverAsync(
    new SettingsTreeRequest {
        ModuleKey = moduleKey,
        RootKey = rootKey,
        SubDirectory = subDirectory,
        Recursive = recursive,
        IncludeFragments = includeFragments,
        IncludeSchemas = includeSchemas
    },
    cancellationToken
));
app.MapPost(HttpRoutes.OpenDocument, async (
    OpenSettingsDocumentRequest request,
    HostSettingsStorageService storageService,
    CancellationToken cancellationToken
) => await storageService.OpenAsync(request, cancellationToken));
app.MapPost(HttpRoutes.ComposeDocument, async (
    OpenSettingsDocumentRequest request,
    HostSettingsStorageService storageService,
    CancellationToken cancellationToken
) => await storageService.ComposeAsync(request, cancellationToken));
app.MapPost(HttpRoutes.ValidateDocument, async (
    ValidateSettingsDocumentRequest request,
    HostSettingsStorageService storageService,
    CancellationToken cancellationToken
) => await storageService.ValidateAsync(request, cancellationToken));
app.MapPost(HttpRoutes.SaveDocument, async (
    SaveSettingsDocumentRequest request,
    HostSettingsStorageService storageService,
    CancellationToken cancellationToken
) => await storageService.SaveAsync(request, cancellationToken));
app.MapHub<BridgeHub>(HubRoutes.Default);

app.Logger.LogInformation(
    "Host listening on {BaseUrl} using pipe {PipeName}",
    options.SignalRBaseUrl,
    options.PipeName
);

app.Run(options.SignalRBaseUrl);
