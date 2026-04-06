using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Resolution;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class ParamDrivenSolidsCompilerTests {
    [Test]
    public void Compile_top_level_named_planes_without_solids() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Planes = new Dictionary<string, AuthoredPlaneSpec> {
                ["Pipe Elevation"] = new() {
                    From = "@Bottom",
                    By = "param:PipeElevation",
                    Dir = "out"
                }
            }
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.Offsets, Has.Count.EqualTo(1));
        Assert.That(result.RefPlanesAndDims.Offsets[0].PlaneName, Is.EqualTo("Pipe Elevation"));
    }

    [Test]
    public void Compile_blocks_top_level_plane_without_direction() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Planes = new Dictionary<string, AuthoredPlaneSpec> {
                ["Pipe Elevation"] = new() {
                    From = "@Bottom",
                    By = "param:PipeElevation"
                }
            }
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Message.Contains("Dir", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_prism_with_inline_named_height_allows_downstream_connector_face_ref() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Prisms = [
                new AuthoredPrismSpec {
                    Name = "Cabinet",
                    On = "@Bottom",
                    Width = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterFB",
                            By = "param:Width",
                            Negative = "Cabinet Back",
                            Positive = "Cabinet Front"
                        }
                    },
                    Length = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterLR",
                            By = "param:Length",
                            Negative = "Cabinet Left",
                            Positive = "Cabinet Right"
                        }
                    },
                    Height = new PlaneRefOrInlinePlaneSpec {
                        InlinePlane = new AuthoredNamedPlaneSpec {
                            Name = "Cabinet Top",
                            From = "@Bottom",
                            By = "param:Height",
                            Dir = "out"
                        }
                    }
                }
            ],
            Connectors = [
                new AuthoredConnectorSpec {
                    Name = "SupplyAir",
                    Domain = ParamDrivenConnectorDomain.Duct,
                    Face = "plane:Cabinet Top",
                    Depth = new AuthoredDepthSpec {
                        By = "param:Depth",
                        Dir = "out"
                    },
                    Round = new AuthoredRoundConnectorGeometrySpec {
                        Center = ["@CenterLR", "@CenterFB"],
                        Diameter = new AuthoredMeasureSpec {
                            By = "param:Diameter"
                        }
                    },
                    Config = new AuthoredConnectorConfigSpec {
                        SystemType = DuctSystemType.SupplyAir.ToString(),
                        FlowConfiguration = DuctFlowConfigurationType.Preset.ToString(),
                        FlowDirection = FlowDirectionType.Out.ToString(),
                        LossMethod = DuctLossMethodType.NotDefined.ToString()
                    }
                }
            ]
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.Connectors.Connectors, Has.Count.EqualTo(1));
        Assert.That(result.Connectors.Connectors[0].HostPlaneName, Is.EqualTo("Reference Plane"));
        Assert.That(result.Connectors.Connectors[0].HostFacePlaneName, Is.EqualTo("__OFFSET__|Cabinet Top|+|P:Height"));
        Assert.That(
            result.RefPlanesAndDims.Offsets.Any(offset => string.Equals(offset.PlaneName, "Cabinet Top", StringComparison.Ordinal)),
            Is.True,
            "Inline height planes that are also referenced by connectors must still be emitted as real offset planes.");
    }

    [Test]
    public void Compile_negative_depth_connector_keeps_host_plane_data_on_compiled_connector() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Connectors = [
                new AuthoredConnectorSpec {
                    Name = "BackConn",
                    Domain = ParamDrivenConnectorDomain.Pipe,
                    Face = "@Bottom",
                    Depth = new AuthoredDepthSpec {
                        By = "param:Depth",
                        Dir = "in"
                    },
                    Round = new AuthoredRoundConnectorGeometrySpec {
                        Center = ["@CenterLR", "@CenterFB"],
                        Diameter = new AuthoredMeasureSpec {
                            By = "param:Diameter"
                        }
                    },
                    Config = new AuthoredConnectorConfigSpec {
                        SystemType = PipeSystemType.ReturnHydronic.ToString(),
                        FlowDirection = FlowDirectionType.In.ToString()
                    }
                }
            ]
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.Offsets, Is.Empty);
        Assert.That(result.Connectors.Connectors, Has.Count.EqualTo(1));
        Assert.That(result.Connectors.Connectors[0].HostPlaneName, Is.EqualTo("Reference Plane"));
        Assert.That(result.Connectors.Connectors[0].HostFacePlaneName, Is.EqualTo("Reference Plane"));
    }

    [Test]
    public void Compile_cylinder_and_prism_can_share_named_plane_refs() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Planes = new Dictionary<string, AuthoredPlaneSpec> {
                ["Core Top"] = new() {
                    From = "@Bottom",
                    By = "param:CoreHeight",
                    Dir = "out"
                }
            },
            Cylinders = [
                new AuthoredCylinderSpec {
                    Name = "Core",
                    On = "@Bottom",
                    Center = ["@CenterLR", "@CenterFB"],
                    Diameter = new AuthoredMeasureSpec {
                        By = "param:CoreDiameter"
                    },
                    Height = new PlaneRefOrInlinePlaneSpec {
                        PlaneRef = "plane:Core Top"
                    }
                }
            ],
            Prisms = [
                new AuthoredPrismSpec {
                    Name = "Cap",
                    On = "plane:Core Top",
                    Width = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterFB",
                            By = "param:CapWidth",
                            Negative = "Cap Back",
                            Positive = "Cap Front"
                        }
                    },
                    Length = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterLR",
                            By = "param:CapLength",
                            Negative = "Cap Left",
                            Positive = "Cap Right"
                        }
                    },
                    Height = new PlaneRefOrInlinePlaneSpec {
                        InlinePlane = new AuthoredNamedPlaneSpec {
                            Name = "Cap Top",
                            From = "plane:Core Top",
                            By = "param:CapHeight",
                            Dir = "out"
                        }
                    }
                }
            ]
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.InternalExtrusions.Circles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles[0].SketchPlaneName, Is.EqualTo("Core Top"));
    }

    [Test]
    public void Compile_blocks_duplicate_top_level_plane_names() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Planes = new Dictionary<string, AuthoredPlaneSpec> {
                ["Pipe Elevation"] = new() { From = "@Bottom", By = "param:PipeElevation", Dir = "out" }
            },
            Spans = [
                new AuthoredSpanSpec {
                    About = "@CenterFB",
                    By = "param:Width",
                    Negative = "Pipe Elevation",
                    Positive = "Other Plane"
                }
            ]
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic => diagnostic.Message.Contains("duplicated", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_blocks_unresolved_named_plane_reference() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Connectors = [
                new AuthoredConnectorSpec {
                    Name = "SupplyWater",
                    Domain = ParamDrivenConnectorDomain.Pipe,
                    Face = "@Bottom",
                    Depth = new AuthoredDepthSpec {
                        By = "param:PipeDepth",
                        Dir = "in"
                    },
                    Round = new AuthoredRoundConnectorGeometrySpec {
                        Center = ["@CenterLR", "plane:Missing Plane"],
                        Diameter = new AuthoredMeasureSpec {
                            By = "param:PipeDiameter"
                        }
                    },
                    Config = new AuthoredConnectorConfigSpec {
                        SystemType = PipeSystemType.ReturnHydronic.ToString(),
                        FlowDirection = FlowDirectionType.In.ToString()
                    }
                }
            ]
        };

        var result = AuthoredParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
    }

    [Test]
    public void CollectReferencedParameterNames_includes_top_level_planes_and_inline_spans() {
        var settings = new AuthoredParamDrivenSolidsSettings {
            Planes = new Dictionary<string, AuthoredPlaneSpec> {
                ["Pipe Elevation"] = new() {
                    From = "@Bottom",
                    By = "param:PipeElevation",
                    Dir = "out"
                }
            },
            Prisms = [
                new AuthoredPrismSpec {
                    Name = "Cabinet",
                    On = "@Bottom",
                    Width = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterFB",
                            By = "param:Width",
                            Negative = "Cabinet Back",
                            Positive = "Cabinet Front"
                        }
                    },
                    Length = new PlanePairOrInlineSpanSpec {
                        InlineSpan = new AuthoredSpanSpec {
                            About = "@CenterLR",
                            By = "param:Length",
                            Negative = "Cabinet Left",
                            Positive = "Cabinet Right"
                        }
                    },
                    Height = new PlaneRefOrInlinePlaneSpec {
                        InlinePlane = new AuthoredNamedPlaneSpec {
                            Name = "Cabinet Top",
                            From = "@Bottom",
                            By = "param:Height",
                            Dir = "out"
                        }
                    }
                }
            ]
        };

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(settings);
        var parameters = KnownParamPlanBuilder.CollectReferencedParameterNames(compiled.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiled.InternalExtrusions))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        Assert.That(parameters, Does.Contain("PipeElevation"));
        Assert.That(parameters, Does.Contain("Width"));
        Assert.That(parameters, Does.Contain("Length"));
        Assert.That(parameters, Does.Contain("Height"));
    }
}
