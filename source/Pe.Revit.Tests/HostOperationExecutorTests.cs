using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Pe.Host.Operations;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Text.Json;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class HostOperationExecutorTests {
    [Test]
    public async Task Host_operation_executor_returns_raw_payload_on_success() {
        var executor = new HostOperationExecutor(NullLogger<HostOperationExecutor>.Instance);
        var operation = HostOperations.Create<NoRequest>(
            GetSchemaOperationContract.Definition,
            static (request, context, cancellationToken) =>
                Task.FromResult(HostOperations.Local(new SchemaData("{\"type\":\"object\"}", null)))
        );

        var result = await executor.ExecuteHttpAsync(operation, new NoRequest(), CreateContext(), CancellationToken.None);
        var response = await ExecuteAsync(result);

        Assert.That(response.StatusCode, Is.EqualTo(StatusCodes.Status200OK));
        Assert.That(response.Json.RootElement.GetProperty("schemaJson").GetString(), Is.EqualTo("{\"type\":\"object\"}"));
        Assert.That(response.Json.RootElement.TryGetProperty("status", out _), Is.False);
    }

    [Test]
    public async Task Host_operation_executor_returns_problem_details_with_issues_for_expected_faults() {
        var executor = new HostOperationExecutor(NullLogger<HostOperationExecutor>.Instance);
        var operation = HostOperations.Create<NoRequest>(
            GetFieldOptionsOperationContract.Definition,
            static (request, context, cancellationToken) => throw new HostOperationException(
                StatusCodes.Status409Conflict,
                "No active document.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "NoActiveDocument",
                        "error",
                        "No active document.",
                        "Open a Revit document and retry."
                    )
                ]
            )
        );

        var result = await executor.ExecuteHttpAsync(operation, new NoRequest(), CreateContext(), CancellationToken.None);
        var response = await ExecuteAsync(result);

        Assert.That(response.StatusCode, Is.EqualTo(StatusCodes.Status409Conflict));
        Assert.That(response.Json.RootElement.GetProperty("detail").GetString(), Is.EqualTo("No active document."));
        Assert.That(response.Json.RootElement.GetProperty("status").GetInt32(), Is.EqualTo(StatusCodes.Status409Conflict));
        var issues = response.Json.RootElement.GetProperty("extensions").GetProperty("issues");
        Assert.That(issues.GetArrayLength(), Is.EqualTo(1));
        Assert.That(issues[0].GetProperty("code").GetString(), Is.EqualTo("NoActiveDocument"));
    }

    [Test]
    public async Task Host_operation_executor_maps_expected_faults_to_problem_details() {
        var executor = new HostOperationExecutor(NullLogger<HostOperationExecutor>.Instance);
        var operation = HostOperations.Create<NoRequest>(
            GetScheduleCatalogOperationContract.Definition,
            static (request, context, cancellationToken) =>
                throw new HostOperationException(StatusCodes.Status503ServiceUnavailable, "No connected Revit bridge session.")
        );

        var result = await executor.ExecuteHttpAsync(operation, new NoRequest(), CreateContext(), CancellationToken.None);
        var response = await ExecuteAsync(result);

        Assert.That(response.StatusCode, Is.EqualTo(StatusCodes.Status503ServiceUnavailable));
        Assert.That(response.Json.RootElement.GetProperty("detail").GetString(),
            Is.EqualTo("No connected Revit bridge session."));
    }

    [Test]
    public void Active_document_revit_operations_declare_supported_document_kinds() {
        var activeDocumentRevitOperations = HostOperationsCatalog.PublicHttp
            .Where(operation => operation.AgentMetadata.Family == HostOperationFamily.Revit)
            .Where(operation => operation.AgentMetadata.RequiresActiveDocument)
            .ToList();

        Assert.That(activeDocumentRevitOperations, Is.Not.Empty);
        Assert.That(
            activeDocumentRevitOperations
                .Where(operation => operation.AgentMetadata.SupportedActiveDocumentKinds.Count == 0)
                .Select(operation => operation.Key),
            Is.Empty);
    }

    [Test]
    public void Loaded_families_operations_are_project_document_operations() {
        var operations = new[] {
            GetLoadedFamiliesCatalogOperationContract.Definition,
            GetLoadedFamiliesMatrixOperationContract.Definition
        };

        foreach (var operation in operations)
            Assert.That(operation.AgentMetadata.SupportedActiveDocumentKinds,
                Is.EqualTo(new[] { RevitActiveDocumentKind.Project }),
                operation.Key);
    }

    private static HostOperationContext CreateContext() =>
        new(
            null!,
            null!,
            null!,
            NullLoggerFactory.Instance
        );

    private static async Task<(int StatusCode, JsonDocument Json)> ExecuteAsync(IResult result) {
        var httpContext = new DefaultHttpContext();
        httpContext.Response.Body = new MemoryStream();

        await result.ExecuteAsync(httpContext);

        httpContext.Response.Body.Position = 0;
        return (httpContext.Response.StatusCode, await JsonDocument.ParseAsync(httpContext.Response.Body));
    }
}
