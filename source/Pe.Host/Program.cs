using Pe.Host;
using Pe.Host.Contracts.Protocol;
using Pe.Host.Operations;
using Pe.Host.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

HostRevitAssemblyResolver.EnsureRegistered();

var builder = WebApplication.CreateBuilder(args);
var options = BridgeHostOptions.FromEnvironment();

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddSingleton<HostEventStreamService>();
builder.Services.AddSingleton<HostOperationRegistry>();
builder.Services.AddSingleton<HostOperationExecutor>();
builder.Services.AddSingleton<IHostBridgeCapabilityService, HostBridgeCapabilityService>();
builder.Services.AddSingleton<IHostSettingsModuleCatalog>(_ => new HostSettingsModuleCatalog());
builder.Services.AddSingleton<HostSettingsRuntimeStateService>();
builder.Services.AddSingleton<HostSchemaService>();
builder.Services.AddSingleton(sp => new HostSettingsStorageService(
    sp.GetRequiredService<IHostSettingsModuleCatalog>()));
builder.Services.AddHostedService(sp => sp.GetRequiredService<BridgeServer>());
builder.Services.ConfigureHttpJsonOptions(jsonOptions => {
    jsonOptions.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    jsonOptions.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    jsonOptions.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddCors(corsOptions => corsOptions.AddDefaultPolicy(policy => policy
    .WithOrigins(options.AllowedOrigins.ToArray())
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseCors();
HostEndpointMapper.MapOperations(app);
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
    "Host listening on {BaseUrl} using pipe {PipeName}",
    options.HostBaseUrl,
    options.PipeName
);

app.Run(options.HostBaseUrl);