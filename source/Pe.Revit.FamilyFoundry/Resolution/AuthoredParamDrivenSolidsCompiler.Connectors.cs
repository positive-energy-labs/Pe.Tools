using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.FamilyFoundry.Resolution;

public static partial class AuthoredParamDrivenSolidsCompiler {
    private static CompileOutcome TryCompileRectConnector(
        AuthoredConnectorSpec connector,
        string hostPlaneName,
        string hostFacePlaneName,
        string stubSolidName,
        OffsetDirection depthDirection,
        LengthDriverSpec depthDriver,
        IDictionary<string, PublishedSpan> spans,
        IDictionary<string, PublishedPlane> planes,
        IDictionary<string, SymmetricPlanePairSpec> symmetricPairs,
        ICollection<CompiledParamDrivenConnectorSpec> connectors,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        ConnectorDomainConfigSpec runtimeConfig
    ) {
        if (connector.Domain == ParamDrivenConnectorDomain.Pipe) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors.Rect",
                "Pipe connectors only support round geometry."));
            return CompileOutcome.Invalid;
        }

        if (connector.Rect!.Center.Count != 2) {
            diagnostics.Add(new ParamDrivenSolidsDiagnostic(
                ParamDrivenDiagnosticSeverity.Error,
                connector.Name,
                "$.ParamDrivenSolids.Connectors.Rect.Center",
                "Rect connector Center must contain exactly two plane refs."));
            return CompileOutcome.Invalid;
        }

        var center1 = ResolvePlaneRef(connector.Rect.Center[0], planes, diagnostics, connector.Name, "$.ParamDrivenSolids.Connectors.Rect.Center");
        var center2 = ResolvePlaneRef(connector.Rect.Center[1], planes, diagnostics, connector.Name, "$.ParamDrivenSolids.Connectors.Rect.Center");
        if (center1.Outcome != CompileOutcome.Compiled || center2.Outcome != CompileOutcome.Compiled)
            return center1.Outcome == CompileOutcome.Deferred || center2.Outcome == CompileOutcome.Deferred
                ? CompileOutcome.Deferred
                : CompileOutcome.Invalid;

        var width = ResolveGeneratedSpan(
            connector.Name,
            "Width",
            connector.Rect.Width,
            $"{connector.Name.Trim()} Width Negative",
            $"{connector.Name.Trim()} Width Positive",
            spans,
            planes,
            symmetricPairs,
            diagnostics,
            "$.ParamDrivenSolids.Connectors.Rect.Width");
        if (width.Outcome != CompileOutcome.Compiled)
            return width.Outcome;

        var length = ResolveGeneratedSpan(
            connector.Name,
            "Length",
            connector.Rect.Length,
            $"{connector.Name.Trim()} Length Negative",
            $"{connector.Name.Trim()} Length Positive",
            spans,
            planes,
            symmetricPairs,
            diagnostics,
            "$.ParamDrivenSolids.Connectors.Rect.Length");
        if (length.Outcome != CompileOutcome.Compiled)
            return length.Outcome;

        connectors.Add(new CompiledParamDrivenConnectorSpec {
            Name = connector.Name.Trim(),
            StubSolidName = stubSolidName,
            Domain = connector.Domain,
            Profile = ParamDrivenConnectorProfile.Rectangular,
            HostPlaneName = hostPlaneName,
            HostFacePlaneName = hostFacePlaneName,
            DepthDirection = depthDirection,
            DepthDriver = depthDriver,
            RectangularStub = new ConstrainedRectangleExtrusionSpec {
                Name = stubSolidName,
                IsSolid = connector.IsSolid,
                StartOffset = 0.0,
                EndOffset = ConnectorStubSeedDepth,
                HeightControlMode = ExtrusionHeightControlMode.EndOffset,
                SketchPlaneName = hostPlaneName,
                PairAPlane1 = width.PlaneName1!,
                PairAPlane2 = width.PlaneName2!,
                PairAParameter = width.Driver.TryGetParameterName() ?? string.Empty,
                PairADriver = width.Driver,
                PairBPlane1 = length.PlaneName1!,
                PairBPlane2 = length.PlaneName2!,
                PairBParameter = length.Driver.TryGetParameterName() ?? string.Empty,
                PairBDriver = length.Driver
            },
            Bindings = connector.Bindings,
            Config = runtimeConfig,
            AuthoredSpec = connector
        });

        return CompileOutcome.Compiled;
    }

    private static bool TryCompileConnectorConfig(
        AuthoredConnectorSpec connector,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        out ConnectorDomainConfigSpec runtimeConfig
    ) {
        runtimeConfig = new ConnectorDomainConfigSpec();

        if (connector.Domain == ParamDrivenConnectorDomain.Duct) {
            if (!TryParseEnum(connector.Config.SystemType, connector.Name, "$.ParamDrivenSolids.Connectors.Config.SystemType", diagnostics, out DuctSystemType systemType) ||
                !TryParseEnum(connector.Config.FlowConfiguration, connector.Name, "$.ParamDrivenSolids.Connectors.Config.FlowConfiguration", diagnostics, out DuctFlowConfigurationType flowConfiguration) ||
                !TryParseEnum(connector.Config.FlowDirection, connector.Name, "$.ParamDrivenSolids.Connectors.Config.FlowDirection", diagnostics, out FlowDirectionType flowDirection) ||
                !TryParseEnum(connector.Config.LossMethod, connector.Name, "$.ParamDrivenSolids.Connectors.Config.LossMethod", diagnostics, out DuctLossMethodType lossMethod)) {
                return false;
            }

            runtimeConfig = new ConnectorDomainConfigSpec {
                Duct = new DuctConnectorConfigSpec {
                    SystemType = systemType,
                    FlowConfiguration = flowConfiguration,
                    FlowDirection = flowDirection,
                    LossMethod = lossMethod
                }
            };
            return true;
        }

        if (connector.Domain == ParamDrivenConnectorDomain.Pipe) {
            if (!TryParseEnum(connector.Config.SystemType, connector.Name, "$.ParamDrivenSolids.Connectors.Config.SystemType", diagnostics, out PipeSystemType pipeSystemType) ||
                !TryParseEnum(connector.Config.FlowDirection, connector.Name, "$.ParamDrivenSolids.Connectors.Config.FlowDirection", diagnostics, out FlowDirectionType pipeFlowDirection)) {
                return false;
            }

            runtimeConfig = new ConnectorDomainConfigSpec {
                Pipe = new PipeConnectorConfigSpec {
                    SystemType = pipeSystemType,
                    FlowDirection = pipeFlowDirection
                }
            };
            return true;
        }

        if (!TryParseEnum(connector.Config.SystemType, connector.Name, "$.ParamDrivenSolids.Connectors.Config.SystemType", diagnostics, out ElectricalSystemType electricalSystemType))
            return false;

        runtimeConfig = new ConnectorDomainConfigSpec {
            Electrical = new ElectricalConnectorConfigSpec {
                SystemType = electricalSystemType
            }
        };
        return true;
    }

    private static bool TryParseEnum<TEnum>(
        string rawValue,
        string specName,
        string path,
        IList<ParamDrivenSolidsDiagnostic> diagnostics,
        out TEnum parsed
    ) where TEnum : struct {
        if (Enum.TryParse(rawValue?.Trim(), true, out parsed))
            return true;

        diagnostics.Add(new ParamDrivenSolidsDiagnostic(
            ParamDrivenDiagnosticSeverity.Error,
            specName,
            path,
            $"Value '{rawValue}' is not valid for {typeof(TEnum).Name}."));
        return false;
    }

    private static bool TryParseOffsetDirection(string rawValue, out OffsetDirection direction) {
        var normalized = rawValue?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) {
            direction = OffsetDirection.Positive;
            return false;
        }

        if (normalized.Equals("out", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("+", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("positive", StringComparison.OrdinalIgnoreCase)) {
            direction = OffsetDirection.Positive;
            return true;
        }

        if (normalized.Equals("in", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("-", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("negative", StringComparison.OrdinalIgnoreCase)) {
            direction = OffsetDirection.Negative;
            return true;
        }

        direction = OffsetDirection.Positive;
        return false;
    }
}
