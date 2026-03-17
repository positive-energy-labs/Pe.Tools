using Pe.Host;
using Pe.Host.Contracts;
using Pe.Host.Services;
using System.Text.Json;
using System.Text.Json.Serialization;

HostRevitAssemblyResolver.EnsureRegistered();

var builder = WebApplication.CreateBuilder(args);
var options = BridgeHostOptions.FromEnvironment();

builder.Services.AddSingleton(options);
builder.Services.AddSingleton<BridgeServer>();
builder.Services.AddSingleton<HostEventStreamService>();
builder.Services.AddSingleton<HostBrowserApiService>();
builder.Services.AddSingleton<IHostBridgeCapabilityService, HostBridgeCapabilityService>();
builder.Services.AddSingleton<IHostSettingsModuleCatalog>(sp =>
    new HostSettingsModuleCatalog(sp.GetRequiredService<IHostBridgeCapabilityService>()));
builder.Services.AddSingleton<HostSettingsRuntimeStateService>();
builder.Services.AddSingleton<HostSettingsEditorService>();
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
app.MapGet(HttpRoutes.HostStatus, (
    HostBrowserApiService browserApiService
) => browserApiService.GetHostStatus());
app.MapGet(HttpRoutes.Schema, (
    string moduleKey,
    HostBrowserApiService browserApiService
) => ExecuteBrowserRequest(() => browserApiService.GetSchema(moduleKey)));
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
app.MapPost(HttpRoutes.FieldOptions, async (
    FieldOptionsRequest request,
    HostBrowserApiService browserApiService,
    CancellationToken cancellationToken
) => await ExecuteBrowserRequestAsync(async () =>
    await browserApiService.GetFieldOptionsAsync(request, cancellationToken)
));
app.MapPost(HttpRoutes.ParameterCatalog, async (
    ParameterCatalogRequest request,
    HostBrowserApiService browserApiService,
    CancellationToken cancellationToken
) => await ExecuteBrowserRequestAsync(async () =>
    await browserApiService.GetParameterCatalogAsync(request, cancellationToken)
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

static IResult ExecuteBrowserRequest<TResponse>(Func<TResponse> action) {
    try {
        return Results.Ok(action());
    } catch (InvalidOperationException ex) {
        return Results.Problem(statusCode: StatusCodes.Status409Conflict, detail: ex.Message);
    } catch (Exception ex) {
        return Results.Problem(statusCode: StatusCodes.Status500InternalServerError, detail: ex.Message);
    }
}

static async Task<IResult> ExecuteBrowserRequestAsync<TResponse>(Func<Task<TResponse>> action) {
    try {
        return Results.Ok(await action());
    } catch (InvalidOperationException ex) {
        return Results.Problem(statusCode: StatusCodes.Status409Conflict, detail: ex.Message);
    } catch (Exception ex) {
        return Results.Problem(statusCode: StatusCodes.Status500InternalServerError, detail: ex.Message);
    }
}
