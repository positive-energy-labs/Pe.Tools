using Pe.Aps;
using Pe.Aps.Auth;
using Pe.Host;
using Pe.Host.Operations;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using System.Text.Json;
using System.Text.Json.Serialization;

const int HostProcessLogMaxLines = 2000;
const long HostLogTrimThresholdBytes = 1_048_576;

var options = BridgeHostOptions.FromEnvironment();
var hostLogFile = new ManagedLogFile(
    ProductRuntimeLayout.ForCurrentUser().Logs.HostLogPath,
    HostProcessLogMaxLines,
    HostLogTrimThresholdBytes
);

using var singletonLease = AcquireSingletonLease(options, hostLogFile);

var builder = WebApplication.CreateBuilder(args);

builder.Logging.AddProvider(new HostFileLoggerProvider(hostLogFile));

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<IApsCredentialProvider>(_ => {
    var credentials = new ApsCredentialSource().ReadCredentials();
    return new Aps.StaticAuthTokenProvider(credentials.WebClientId, credentials.WebClientSecret);
});
builder.Services.AddSingleton<ApsAuthService>();
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddSingleton<HostActivityService>();
builder.Services.AddSingleton<HostEventStreamService>();
builder.Services.AddSingleton<HostOperationRegistry>();
builder.Services.AddSingleton<HostOperationExecutor>();
builder.Services.AddSingleton<IHostSettingsModuleCatalog, HostSettingsModuleCatalog>();
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
app.UseWebSockets();
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
app.Map(HttpRoutes.Bridge, async (
    HttpContext httpContext,
    BridgeServer bridgeServer,
    CancellationToken cancellationToken
) => {
    if (!httpContext.WebSockets.IsWebSocketRequest) {
        httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
        await httpContext.Response.WriteAsync("Expected WebSocket bridge request.", cancellationToken);
        return;
    }

    using var webSocket = await httpContext.WebSockets.AcceptWebSocketAsync();
    await bridgeServer.RunWebSocketSessionAsync(webSocket, httpContext.RequestAborted);
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
    "Host listening on {BaseUrl} using private bridge {BridgePath}. IdleShutdownEnabled={IdleShutdownEnabled}, IdleShutdownTimeoutMinutes={IdleShutdownTimeoutMinutes}",
    options.HostBaseUrl,
    HttpRoutes.Bridge,
    options.IdleShutdownEnabled,
    options.IdleShutdownTimeout.TotalMinutes
);
app.Logger.LogInformation("Host file logging enabled at {LogFilePath}", hostLogFile.FilePath);
_ = singletonLease.StopWhenTakeoverRequestedAsync(app);

app.Run(options.HostBaseUrl);

static HostSingletonLease AcquireSingletonLease(BridgeHostOptions options, ManagedLogFile hostLogFile) {
    try {
        hostLogFile.AppendStructuredEntry("INF", "Pe.Host.Program", $"Starting Pe.Host for {options.HostBaseUrl}.");
        return HostSingletonGuard.AcquireOrTakeOver(options, hostLogFile);
    } catch (Exception ex) {
        hostLogFile.AppendStructuredEntry("CRT", "Pe.Host.Program", "Pe.Host startup failed before web host initialization completed.", exception: ex);
        throw;
    }
}
