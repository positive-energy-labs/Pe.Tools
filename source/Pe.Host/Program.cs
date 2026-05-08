using Pe.Aps.Auth;
using Pe.Host;
using Pe.Host.Operations;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.SettingsLayout;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

const int HostProcessLogMaxLines = 2000;
const long HostLogTrimThresholdBytes = 1_048_576;

var options = BridgeHostOptions.FromEnvironment();
using var singletonHandle = HostSingletonGuard.TryAcquireOrExit(options);
if (singletonHandle == null)
    return;

var builder = WebApplication.CreateBuilder(args);
var hostLogFile = new ManagedLogFile(
    GlobalStorageLocations.ResolveHostLogPath(),
    HostProcessLogMaxLines,
    HostLogTrimThresholdBytes
);

builder.Logging.AddProvider(new HostFileLoggerProvider(hostLogFile));

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<ApsCredentialSource>();
builder.Services.AddSingleton<ApsAuthService>();
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddSingleton<HostActivityService>();
builder.Services.AddSingleton<HostEventStreamService>();
builder.Services.AddSingleton<HostOperationRegistry>();
builder.Services.AddSingleton<HostOperationExecutor>();
builder.Services.AddSingleton<IHostBridgeCapabilityService, HostBridgeCapabilityService>();
builder.Services.AddSingleton<IHostScriptingPipeClientService, HostScriptingPipeClientService>();
builder.Services.AddSingleton<IHostSettingsModuleCatalog, HostSettingsModuleCatalog>();
builder.Services.AddSingleton<HostSettingsRuntimeStateService>();
builder.Services.AddSingleton(sp => new HostSettingsStorageService(
    sp.GetRequiredService<IHostSettingsModuleCatalog>(),
    sp.GetRequiredService<BridgeServer>()
));
builder.Services.AddHostedService(sp => sp.GetRequiredService<BridgeServer>());
builder.Services.AddHostedService<HostIdleMonitorService>();
builder.Services.ConfigureHttpJsonOptions(jsonOptions => {
    jsonOptions.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    jsonOptions.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    jsonOptions.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddCors(corsOptions => corsOptions.AddDefaultPolicy(policy => policy
    .WithOrigins(options.AllowedOrigins.ToArray())
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()
));

var app = builder.Build();

app.UseCors();
app.Use(async (httpContext, next) => {
    var activityService = httpContext.RequestServices.GetRequiredService<HostActivityService>();
    activityService.OnRequestStarted();
    try {
        await next();
    } finally {
        activityService.OnRequestCompleted();
    }
});
HostEndpointMapper.MapOperations(app);
app.MapPost("/api/dev/mastracode-agent/start", () => {
    var agentDirectory = ResolveMastraCodeAgentDirectory();
    var workspaceRoot = ScriptingWorkspaceLocations.ResolveWorkspaceRoot("agent-poc");
    Directory.CreateDirectory(workspaceRoot);

    var command = $"cd /d \"{agentDirectory}\" && set PE_SCRIPT_WORKSPACE_ROOT={workspaceRoot}&& set PE_SCRIPT_WORKSPACE=agent-poc&& set PE_HOST_URL={options.HostBaseUrl}&& pnpm start";
    Process.Start(new ProcessStartInfo {
        FileName = "cmd.exe",
        Arguments = $"/c start \"Revit Agent POC\" cmd /k \"{command}\"",
        UseShellExecute = false,
        CreateNoWindow = true
    });

    return Results.Ok(new {
        message = "Started Revit Agent POC terminal.",
        agentDirectory,
        workspaceRoot,
        hostBaseUrl = options.HostBaseUrl
    });
});
app.MapGet(HttpRoutes.Events, async (
    HttpContext httpContext,
    HostEventStreamService eventStreamService,
    CancellationToken cancellationToken
) => {
    httpContext.Response.Headers.CacheControl = "no-cache";
    httpContext.Response.Headers.Connection = "keep-alive";
    httpContext.Response.ContentType = "text/event-stream";

    var reader = eventStreamService.Subscribe(cancellationToken);
    while (!cancellationToken.IsCancellationRequested) {
        try {
            var hasData = await reader.WaitToReadAsync(cancellationToken)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);

            if (!hasData)
                break;
        } catch (TimeoutException) {
            await httpContext.Response.WriteAsync(": ping\n\n", cancellationToken);
            await httpContext.Response.Body.FlushAsync(cancellationToken);
            continue;
        }

        while (reader.TryRead(out var hostEvent)) {
            await httpContext.Response.WriteAsync($"event: {hostEvent.EventName}\n", cancellationToken);
            await httpContext.Response.WriteAsync($"data: {hostEvent.PayloadJson}\n\n", cancellationToken);
            await httpContext.Response.Body.FlushAsync(cancellationToken);
        }
    }
});
app.Logger.LogInformation(
    "Host listening on {BaseUrl} using pipe {PipeName}. IdleShutdownEnabled={IdleShutdownEnabled}, IdleShutdownTimeoutMinutes={IdleShutdownTimeoutMinutes}",
    options.HostBaseUrl,
    options.PipeName,
    options.IdleShutdownEnabled,
    options.IdleShutdownTimeout.TotalMinutes
);
app.Logger.LogInformation("Host file logging enabled at {LogFilePath}", hostLogFile.FilePath);

app.Run(options.HostBaseUrl);

static string ResolveMastraCodeAgentDirectory() {
    var configuredPath = Environment.GetEnvironmentVariable("PE_MASTRACODE_AGENT_DIR");
    if (!string.IsNullOrWhiteSpace(configuredPath) && Directory.Exists(configuredPath))
        return Path.GetFullPath(configuredPath);

    var current = new DirectoryInfo(Directory.GetCurrentDirectory());
    while (current != null) {
        var candidate = Path.Combine(current.FullName, "source", "mastra-agent-test");
        if (Directory.Exists(candidate))
            return candidate;

        current = current.Parent;
    }

    throw new DirectoryNotFoundException(
        "Could not find source/mastra-agent-test. Set PE_MASTRACODE_AGENT_DIR to the POC agent directory."
    );
}
