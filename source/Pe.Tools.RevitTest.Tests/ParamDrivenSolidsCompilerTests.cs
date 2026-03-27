using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Resolution;
using Pe.FamilyFoundry.Snapshots;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class ParamDrivenSolidsCompilerTests {
    [Test]
    public void Compile_rectangle_generates_internal_ref_planes_and_extrusion() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "MagicBox",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Width",
                        CenterAnchor = "Center (Front/Back)",
                        PlaneNameBase = "width",
                        Strength = RpStrength.StrongRef
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Length",
                        CenterAnchor = "Center (Left/Right)",
                        PlaneNameBase = "length",
                        Strength = RpStrength.StrongRef
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "Height",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.MirrorSpecs, Has.Count.EqualTo(2));
        Assert.That(result.RefPlanesAndDims.OffsetSpecs, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles[0].PairAPlane1, Is.EqualTo("width (Back)"));
        Assert.That(result.InternalExtrusions.Rectangles[0].PairBPlane2, Is.EqualTo("length (Right)"));
        Assert.That(result.InternalExtrusions.Rectangles[0].HeightPlaneTop, Is.EqualTo("top"));
    }

    [Test]
    public void Compile_blocks_ambiguous_inference() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "BadBox",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Width",
                        CenterAnchor = "Center (Front/Back)",
                        Inference = new InferenceInfo {
                            Status = InferenceStatus.Ambiguous,
                            Warnings = ["Needs manual review."]
                        }
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Length",
                        CenterAnchor = "Center (Left/Right)"
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "Height",
                        Anchor = "Reference Plane"
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Severity == ParamDrivenDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("Ambiguous", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_dedupes_exact_shared_constraints() {
        var sharedWidth = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = "Width",
            CenterAnchor = "Center (Front/Back)",
            PlaneNameBase = "width",
            Strength = RpStrength.StrongRef
        };
        var sharedLength = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = "Length",
            CenterAnchor = "Center (Left/Right)",
            PlaneNameBase = "length",
            Strength = RpStrength.StrongRef
        };

        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "Lower",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = sharedWidth,
                    Length = sharedLength,
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "LowerHeight",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "lower top"
                    }
                },
                new ParamDrivenRectangleSpec {
                    Name = "Upper",
                    Sketch = new SketchTargetSpec { Plane = "Lower.Height.Top" },
                    Width = sharedWidth,
                    Length = sharedLength,
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "UpperHeight",
                        Anchor = "Lower.Height.Top",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "upper top"
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.MirrorSpecs, Has.Count.EqualTo(2));
        Assert.That(result.InternalExtrusions.Rectangles, Has.Count.EqualTo(2));
    }

    [Test]
    public void Compile_cylinder_can_target_rectangle_top_plane_alias() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "Box",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Width",
                        CenterAnchor = "Center (Front/Back)",
                        PlaneNameBase = "width",
                        Strength = RpStrength.StrongRef
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Length",
                        CenterAnchor = "Center (Left/Right)",
                        PlaneNameBase = "length",
                        Strength = RpStrength.StrongRef
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "BoxHeight",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "box top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ],
            Cylinders = [
                new ParamDrivenCylinderSpec {
                    Name = "TopCylinder",
                    Sketch = new SketchTargetSpec { Plane = "Box.Height.Top" },
                    CenterLeftRightPlane = "Center (Left/Right)",
                    CenterFrontBackPlane = "Center (Front/Back)",
                    Diameter = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Diameter",
                        PlaneNameBase = "diameter",
                        Strength = RpStrength.StrongRef
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "CylinderHeight",
                        Anchor = "Box.Height.Top",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "cylinder top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.InternalExtrusions.Circles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Circles[0].SketchPlaneName, Is.EqualTo("box top"));
        Assert.That(result.InternalExtrusions.Circles[0].CenterLeftRightPlane, Is.EqualTo("Center (Left/Right)"));
        Assert.That(result.InternalExtrusions.Circles[0].CenterFrontBackPlane, Is.EqualTo("Center (Front/Back)"));
        Assert.That(result.InternalExtrusions.Circles[0].DiameterParameter, Is.EqualTo("Diameter"));
        Assert.That(result.InternalExtrusions.Circles[0].HeightPlaneBottom, Is.EqualTo("box top"));
        Assert.That(result.InternalExtrusions.Circles[0].HeightPlaneTop, Is.EqualTo("cylinder top"));
    }

    [Test]
    public void Compile_blocks_ambiguous_cylinder_inference() {
        var settings = new ParamDrivenSolidsSettings {
            Cylinders = [
                new ParamDrivenCylinderSpec {
                    Name = "BadCylinder",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    CenterLeftRightPlane = "Center (Left/Right)",
                    CenterFrontBackPlane = "Center (Front/Back)",
                    Diameter = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Diameter",
                        Inference = new InferenceInfo {
                            Status = InferenceStatus.Ambiguous,
                            Warnings = ["Diameter semantics are ambiguous."]
                        }
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "Height",
                        Anchor = "Reference Plane"
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Severity == ParamDrivenDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("Ambiguous", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_round_duct_connector_generates_connector_plan() {
        var settings = new ParamDrivenSolidsSettings {
            Connectors = [
                new ParamDrivenConnectorSpec {
                    Name = "SupplyConn",
                    Domain = ParamDrivenConnectorDomain.Duct,
                    Host = new ConnectorHostSpec {
                        SketchPlane = "Ref. Level",
                        Depth = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Depth",
                            Anchor = "Ref. Level",
                            Direction = OffsetDirection.Positive,
                            PlaneNameBase = "conn face",
                            Strength = RpStrength.StrongRef
                        }
                    },
                    Geometry = new ConnectorStubGeometrySpec {
                        Profile = ParamDrivenConnectorProfile.Round,
                        CenterLeftRightPlane = "Center (Left/Right)",
                        CenterFrontBackPlane = "Center (Front/Back)",
                        Diameter = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Diameter"
                        }
                    },
                    Config = new ConnectorDomainConfigSpec {
                        Duct = new DuctConnectorConfigSpec { SystemType = DuctSystemType.SupplyAir }
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.Connectors.Connectors, Has.Count.EqualTo(1));
        Assert.That(result.Connectors.Connectors[0].RoundStub, Is.Not.Null);
        Assert.That(result.SemanticAliases["SupplyConn.HostFace"], Is.EqualTo("SupplyConn HostFace"));
    }

    [Test]
    public void Compile_allows_negative_connector_depth_direction() {
        var settings = new ParamDrivenSolidsSettings {
            Connectors = [
                new ParamDrivenConnectorSpec {
                    Name = "BackConn",
                    Domain = ParamDrivenConnectorDomain.Pipe,
                    Host = new ConnectorHostSpec {
                        SketchPlane = "Ref. Level",
                        Depth = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Depth",
                            Anchor = "Ref. Level",
                            Direction = OffsetDirection.Negative,
                            PlaneNameBase = "back conn face",
                            Strength = RpStrength.StrongRef
                        }
                    },
                    Geometry = new ConnectorStubGeometrySpec {
                        Profile = ParamDrivenConnectorProfile.Round,
                        CenterLeftRightPlane = "Center (Left/Right)",
                        CenterFrontBackPlane = "Center (Front/Back)",
                        Diameter = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Diameter"
                        }
                    },
                    Config = new ConnectorDomainConfigSpec {
                        Pipe = new PipeConnectorConfigSpec { SystemType = PipeSystemType.ReturnHydronic }
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.Connectors.Connectors, Has.Count.EqualTo(1));
        Assert.That(result.Connectors.Connectors[0].RoundStub, Is.Not.Null);
    }

    [Test]
    public void Compile_blocks_rectangular_pipe_connector() {
        var settings = new ParamDrivenSolidsSettings {
            Connectors = [
                new ParamDrivenConnectorSpec {
                    Name = "BadPipe",
                    Domain = ParamDrivenConnectorDomain.Pipe,
                    Host = new ConnectorHostSpec {
                        SketchPlane = "Ref. Level",
                        Depth = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Depth",
                            Anchor = "Ref. Level"
                        }
                    },
                    Geometry = new ConnectorStubGeometrySpec {
                        Profile = ParamDrivenConnectorProfile.Rectangular,
                        Width = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Width",
                            CenterAnchor = "Center (Front/Back)"
                        },
                        Length = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror,
                            Parameter = "Length",
                            CenterAnchor = "Center (Left/Right)"
                        }
                    },
                    Config = new ConnectorDomainConfigSpec {
                        Pipe = new PipeConnectorConfigSpec()
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Path.Contains("Geometry.Profile", StringComparison.Ordinal) &&
            diagnostic.Message.Contains("Pipe", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_blocks_connector_when_required_parameter_name_is_missing() {
        var settings = new ParamDrivenSolidsSettings {
            Connectors = [
                new ParamDrivenConnectorSpec {
                    Name = "BadConn",
                    Domain = ParamDrivenConnectorDomain.Duct,
                    Host = new ConnectorHostSpec {
                        SketchPlane = "Ref. Level",
                        Depth = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Offset,
                            Parameter = "Depth",
                            Anchor = "Ref. Level"
                        }
                    },
                    Geometry = new ConnectorStubGeometrySpec {
                        Profile = ParamDrivenConnectorProfile.Round,
                        CenterLeftRightPlane = "Center (Left/Right)",
                        CenterFrontBackPlane = "Center (Front/Back)",
                        Diameter = new AxisConstraintSpec {
                            Mode = AxisConstraintMode.Mirror
                        }
                    },
                    Config = new ConnectorDomainConfigSpec {
                        Duct = new DuctConnectorConfigSpec { SystemType = DuctSystemType.SupplyAir }
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Path.Contains("Geometry.Diameter.Parameter", StringComparison.Ordinal) &&
            diagnostic.Message.Contains("driving", StringComparison.OrdinalIgnoreCase)), Is.True);
    }
}
