using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using DataStorage = Autodesk.Revit.DB.ExtensibleStorage.DataStorage;
using Pe.Revit.FamilyFoundry.LookupTables;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;
using System.Globalization;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Reads a family document BY NAME into the native <see cref="FamilyModel" /> (VERDICTS-R2 §L2). Only a
///     Document goes in: no authored profile, no plan, no metadata. Every section reports its
///     <see cref="FamilyModel.Coverage" />; every fact the schema cannot say lands in
///     <see cref="FamilyModel.Unmodeled" /> with a closed reason. Capture never folds a macro back (§1).
///     Method proofs: r2-revit claims 3 (nested alignments by <c>FamilyInstanceReferenceType</c>),
///     4 (sketch locks via <c>Sketch.GetAllElements</c> + Constraints alignments), 5 (array anchor is not
///     stored); c-revit §4 (visibility both directions), §5 LAW rows.
/// </summary>
public static class FamilyModelCaptureExtensions {
    public static FamilyModel CaptureFamilyModel(this Document document) {
        if (document == null) throw new ArgumentNullException(nameof(document));
        if (!document.IsFamilyDocument) throw new InvalidOperationException("Expected a family document.");
        return new FamilyModelCapturer(document).Run();
    }
}

internal sealed class FamilyModelCapturer {
    private const double Tol = 1e-6;
    private const double FaceTol = 1e-4;
    private const double PeRoomCalculationOffsetFeet = 1.0;

    private readonly Document _d;
    private readonly FamilyManager _fm;
    private readonly List<FamilyModelUnmodeledFact> _un = [];
    private readonly Dictionary<ElementId, string> _planeName = [];
    private readonly List<ReferencePlane> _refPlanes;
    private readonly List<Level> _levels;
    private readonly List<ModelCurve> _refLines;
    private readonly List<(Dimension Dim, List<Reference> Refs)> _alignments;
    private readonly List<Dimension> _dimensions;
    private readonly Dictionary<ElementId, string> _nestedSlug = [];
    private readonly Dictionary<ElementId, string> _formSlug = [];
    private readonly Dictionary<ElementId, IReadOnlyList<string>> _nestedPlaneNames = [];

    public FamilyModelCapturer(Document d) {
        this._d = d;
        this._fm = d.FamilyManager;
        this._refPlanes = Collect<ReferencePlane>().OrderBy(p => p.Id.Value()).ToList();
        this._levels = Collect<Level>().OrderBy(l => l.Id.Value()).ToList();
        this._refLines = FamilyRefs.ReferenceLines(d).ToList();
        var dims = Collect<Dimension>().Where(x => x is not SpotDimension).OrderBy(x => x.Id.Value()).ToList();
        this._alignments = dims.Where(x => x.Category?.Id.Value() == (long)BuiltInCategory.OST_Constraints && x.Name == "Alignment")
            .Select(x => (x, x.References.Cast<Reference>().ToList())).ToList();
        this._dimensions = dims.Where(x => x.Category?.Id.Value() != (long)BuiltInCategory.OST_Constraints).ToList();
    }

    public FamilyModel Run() {
        var placement = (FamilyModelPlacement)Enum.Parse(typeof(FamilyModelPlacement), this._d.OwnerFamily.FamilyPlacementType.ToString());
        var categoryName = this._d.OwnerFamily.FamilyCategory?.Name ?? string.Empty;
        if (!LenientEnumConverter<FamilyCategory>.TryParse(categoryName, out var category)) {
            this.Add(UnmodeledReason.TemplateUnknown, "$.family.category", ("category", categoryName));
            category = FamilyCategory.GenericModels;
        }

        var snapshot = this._d.CaptureFamilySnapshot();
        var typeNames = this._fm.Types.Cast<FamilyType>().Select(t => t.Name).ToList();
        var projected = FamilyModelParameterProjection.Project(
            (snapshot.Parameters?.Data ?? []).Select(p => p.ToCanonical()), typeNames);
        this._un.AddRange(projected.Unmodeled);

        var (datums, refPlanes) = this.Planes();
        var known = new HashSet<string>(datums.Keys.Concat(refPlanes.Keys), StringComparer.Ordinal);
        var refLines = this.RefLines(known);
        var forms = this.Forms(known);
        var nested = this.Nested(known);
        var arrays = this.Arrays();
        var connectors = this.Connectors(known);
        var dimensions = this.Dimensions(known);
        if (Collect<DataStorage>().Any())
            this.Add(UnmodeledReason.ThirdPartyStorage, "$", ("dataStorageElements", Collect<DataStorage>().Count().ToString(CultureInfo.InvariantCulture)));

        var coverage = FamilyModel.SectionNames.ToDictionary(s => s, _ => CoverageState.Read, StringComparer.Ordinal);
        coverage["details"] = CoverageState.NotRead;

        return new FamilyModel {
            Family = new FamilyModelHeader {
                Name = string.IsNullOrWhiteSpace(this._d.OwnerFamily.Name) ? Path.GetFileNameWithoutExtension(this._d.Title) : this._d.OwnerFamily.Name,
                Category = category,
                Template = this.InferTemplate(category, placement),
                Placement = placement
            },
            Parameters = projected.Parameters,
            Types = projected.Types,
            Datums = datums,
            RefPlanes = refPlanes,
            RefLines = refLines,
            Dimensions = dimensions,
            Forms = forms,
            Nested = nested,
            Arrays = arrays,
            Connectors = connectors,
            Settings = this.Settings(),
            LookupTables = this.LookupTables(snapshot),
            RoomCalculationPoint = this.RoomCalculationPoint(placement),
            Coverage = coverage,
            Unmodeled = this._un
        };
    }

    // ───────────────────────────── datums, refPlanes, refLines ─────────────────────────────

    private (Dictionary<string, FamilyModelDatum>, Dictionary<string, FamilyModelRefPlane>) Planes() {
        var datums = new Dictionary<string, FamilyModelDatum>(StringComparer.Ordinal);
        var planes = new Dictionary<string, FamilyModelRefPlane>(StringComparer.Ordinal);
        foreach (var level in this._levels) {
            this._planeName[level.Id] = level.Name;
            datums[level.Name] = new FamilyModelDatum { Normal = Axis.Z, IsLevel = true };
        }

        var unnamed = 0;
        foreach (var rp in this._refPlanes) {
            var definesOrigin = rp.get_Parameter(BuiltInParameter.DATUM_PLANE_DEFINES_ORIGIN)?.AsInteger() == 1;
            var name = rp.Name;
            if (!definesOrigin && (string.IsNullOrWhiteSpace(name) || name == "Reference Plane")) {
                name = $"plane-{++unnamed}";
                this.Add(UnmodeledReason.PlaneNotNamed, $"$.refPlanes.{name}", ("revitName", rp.Name ?? ""));
            }
            name = Unique(name, k => datums.ContainsKey(k) || planes.ContainsKey(k));
            this._planeName[rp.Id] = name;
            var axis = ToAxis(rp.Normal);
            if (axis == null) {
                this.Add(UnmodeledReason.PlaneNotAxisAligned, $"$.refPlanes.{name}", ("normal", Fmt(rp.Normal)));
                continue;
            }

            if (definesOrigin) {
                // RULING (kaitpw, 2026-09-06): a datum normal is unsigned. Revit's stored sign for a
                // template plane varies ('Center (Front/Back)' reads MinusY here), and a datum carries no
                // seed for the sign to drive, so the sign is folded away.
                datums[name] = new FamilyModelDatum { Normal = axis.Value.Unsigned() };
                continue;
            }

            planes[name] = new FamilyModelRefPlane {
                Normal = axis.Value,
                At = PortableLength.FromFeet(Math.Round(rp.GetPlane().Origin.DotProduct(rp.Normal), 9) + 0.0),
                IsReference = Strength(rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.AsInteger()),
                Subcategory = rp.Category?.Parent == null ? null : rp.Category.Name
            };
        }

        return (datums, planes);
    }

    /// <summary>
    ///     RULING (kaitpw, 2026-09-06): a reference line keys as `line-&lt;n&gt;` in document order.
    ///     Revit gives a reference line no user name. `Element.Name` of a reference line is its line STYLE,
    ///     for example `Reference Lines`. Every reference line in a family therefore reads the same name,
    ///     and a name cannot be the key.
    ///     Capture numbers the reference lines in the order the document returns them, and writes `line-1`,
    ///     `line-2`, and so on. The author writes the same keys. Capture also records each reference line as
    ///     `unmodeled` with reason `PlaneNotNamed`, because the key is a position and not a name.
    ///     This naming scheme is a PLACEHOLDER. A positional key changes when the author adds a reference
    ///     line before an existing one, and the diff then reports every later reference line as changed.
    ///     Replace this scheme when Revit gives a reference line a stable user name, or when the reconciler
    ///     keys a reference line on its own structure.
    /// </summary>
    private Dictionary<string, FamilyModelRefLine> RefLines(ISet<string> known) {
        var result = new Dictionary<string, FamilyModelRefLine>(StringComparer.Ordinal);
        var n = 0;
        foreach (var line in this._refLines) {
            var name = $"line-{++n}";
            this._planeName[line.Id] = name;
            this.Add(UnmodeledReason.PlaneNotNamed, $"$.refLines.{name}", ("element", "ModelCurve"), ("style", line.Name ?? ""));
            var on = line.SketchPlane?.Name ?? string.Empty;
            var from = this._alignments
                .Where(a => a.Refs.Any(r => r.ElementId == line.Id && StableOf(r).EndsWith("/0", StringComparison.Ordinal)))
                .SelectMany(a => a.Refs.Where(r => r.ElementId != line.Id).Select(r => this.NameOf(r)))
                .OfType<string>().Distinct(StringComparer.Ordinal).ToList();
            var angular = this._dimensions
                .Where(x => x.DimensionShape == DimensionShape.Angular && x.References.Cast<Reference>().Any(r => r.ElementId == line.Id))
                .Select(x => (Label: SafeLabel(x), Other: x.References.Cast<Reference>().Where(r => r.ElementId != line.Id).Select(r => this.NameOf(r)).FirstOrDefault()))
                .FirstOrDefault(x => x.Label != null && x.Other != null);
            var lengthLabel = this._dimensions.Where(x => x.DimensionShape == DimensionShape.Linear &&
                    x.References.Size == 2 && x.References.Cast<Reference>().All(r => r.ElementId == line.Id))
                .Select(SafeLabel).FirstOrDefault(label => label is not null);
            result[name] = new FamilyModelRefLine {
                On = on,
                From = from,
                Length = lengthLabel is null ? PortableLength.FromFeet(line.GeometryCurve.Length) : PortableLength.Parse($"param:{lengthLabel}"),
                AngleFrom = angular.Other,
                Angle = angular.Label == null ? null : PortableAngle.Parse($"param:{angular.Label}")
            };
            if (!known.Contains(on)) this.Add(UnmodeledReason.PlaneNotNamed, $"$.refLines.{name}.on", ("sketchPlane", on));
        }

        return result;
    }

    // ───────────────────────────── dimensions ─────────────────────────────

    private Dictionary<string, FamilyModelDim> Dimensions(ISet<string> known) {
        var result = new Dictionary<string, FamilyModelDim>(StringComparer.Ordinal);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var dim in this._dimensions) {
            if ((dim.Category?.Name ?? "").Contains("Automatic Sketch", StringComparison.Ordinal)) continue;
            var refs = dim.References.Cast<Reference>().ToList();
            var label = SafeLabel(dim);
            if (refs.Any(r => this._refLines.Any(line => line.Id == r.ElementId)) &&
                (dim.DimensionShape == DimensionShape.Angular || refs.Select(r => r.ElementId).Distinct().Count() == 1)) continue;
            var eq = dim.NumberOfSegments > 1 && dim.AreSegmentsEqual;
            var locked = dim.NumberOfSegments <= 1 && Try(() => dim.IsLocked);
            if (label == null && !eq && !locked) continue; // annotation only; not authored truth

            var names = refs.Select(r => this.NameOf(r)).ToList();
            if (names.Any(x => x == null)) {
                // A labeled radial/diameter dimension on a sketch curve belongs to its form (forms[].profile).
                if (label != null && refs.All(r => this._d.GetElement(r.ElementId) is ModelCurve mc && !mc.IsReferenceLine)) continue;
                this.Add(UnmodeledReason.DimensionToFace, "$.dimensions",
                    ("label", label ?? ""), ("references", string.Join(" | ", refs.Select(r => this.Describe(r)))));
                continue;
            }

            var between = names.Select(x => x!).ToList();
            var slug = label != null ? Slug(label) : (eq ? "eq-" : "lock-") + string.Join("-", between.Select(Slug));
            var identity = (label ?? (eq ? "eq" : "lock")) + "|" + string.Join("|", between);
            if (!keys.Add(identity)) {
                this.Add(UnmodeledReason.IdentityNotUnique, $"$.dimensions.{slug}", ("identity", identity));
                continue;
            }

            slug = Unique(slug, result.ContainsKey);
            result[slug] = new FamilyModelDim {
                Between = between,
                Label = label,
                Equality = eq ? true : null,
                Locked = label == null && !eq && locked ? PortableLength.FromFeet(Math.Round(dim.Value ?? 0, 9)) : null,
                View = this.StockViewOf(dim, slug)
            };
        }

        return result;
    }

    private StockView? StockViewOf(Dimension dim, string slug) {
        var view = dim.View;
        if (view == null) return null;
        var stock = view.Name switch {
            "Ref. Level" => (StockView?)StockView.RefLevel,
            "Front" => StockView.Front, "Back" => StockView.Back, "Left" => StockView.Left, "Right" => StockView.Right,
            _ => null
        };
        if (stock == null) this.Add(UnmodeledReason.ViewNotStock, $"$.dimensions.{slug}.view", ("view", view.Name));
        return stock;
    }

    // ───────────────────────────── forms ─────────────────────────────

    private Dictionary<string, FamilyModelForm> Forms(ISet<string> known) {
        var result = new Dictionary<string, FamilyModelForm>(StringComparer.Ordinal);
        var planeSets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var form in Collect<GenericForm>().OrderBy(f => f.Id.Value())) {
            if (form is not Extrusion ext) {
                this.Add(UnmodeledReason.KindNotInVocabulary, "$.forms", ("class", form.GetType().Name), ("name", form.Name ?? ""));
                continue;
            }

            var sketchPlane = ext.Sketch?.SketchPlane?.Name ?? string.Empty;
            if (!known.Contains(sketchPlane)) {
                this.Add(sketchPlane == "Reference Lines" ? UnmodeledReason.FormSketchPlaneOnReferenceLine : UnmodeledReason.PlaneNotNamed,
                    "$.forms", ("name", ext.Name ?? ""), ("sketchPlane", sketchPlane));
                continue;
            }

            var curves = ext.Sketch!.GetAllElements().Select(this._d.GetElement).OfType<ModelCurve>().ToList();
            var loops = new List<FamilyModelLoop>();
            var lockedTo = new List<string>();
            var ok = true;
            foreach (CurveArray loop in ext.Sketch.Profile) {
                var portable = new List<FamilyModelSketchCurve>();
                foreach (Curve curve in loop) {
                    var mc = curves.FirstOrDefault(c => SameCurve(c.GeometryCurve, curve));
                    if (curve is Line && mc != null) {
                        var on = this.LockPlane(mc.Id);
                        if (on == null) {
                            this.Add(UnmodeledReason.SketchLineUnlocked, "$.forms", ("name", ext.Name ?? ""),
                                ("start", Fmt(curve.GetEndPoint(0))), ("end", Fmt(curve.GetEndPoint(1))));
                            ok = false;
                            break;
                        }

                        lockedTo.Add(on);
                        portable.Add(new FamilyModelSketchCurve { Kind = CurveKind.Line, On = on });
                    } else if (curve is Arc arc && !arc.IsBound && mc != null) {
                        var center = this.CrossingPlanesThrough(arc.Center, arc.Normal);
                        if (center == null) {
                            this.Add(UnmodeledReason.SketchLineUnlocked, "$.forms", ("name", ext.Name ?? ""), ("circleCenter", Fmt(arc.Center)));
                            ok = false;
                            break;
                        }

                        var radial = this._dimensions.Where(x => x.References.Cast<Reference>().Any(r => r.ElementId == mc.Id)).Select(SafeLabel).FirstOrDefault(l => l != null);
                        lockedTo.AddRange(center);
                        portable.Add(new FamilyModelSketchCurve {
                            Kind = CurveKind.Circle, Center = center,
                            Diameter = radial != null ? PortableLength.Parse($"param:{radial}") : PortableLength.FromFeet(Math.Round(arc.Radius * 2, 9))
                        });
                    } else {
                        this.Add(UnmodeledReason.CurveNotLineOrCircle, "$.forms", ("name", ext.Name ?? ""), ("curve", curve.GetType().Name));
                        ok = false;
                        break;
                    }
                }

                if (!ok) break;
                loops.Add(new FamilyModelLoop { Curves = portable });
            }

            if (!ok) continue;

            var support = ext.Sketch.SketchPlane.GetPlane();
            string? CapPlane(double offset) => this.NamedPlanesThrough(support.Origin + support.Normal * offset,
                p => Math.Abs(Math.Abs(p.Normal.DotProduct(support.Normal)) - 1) < Tol).FirstOrDefault();
            var start = CapPlane(ext.StartOffset);
            var end = CapPlane(ext.EndOffset);
            if (start is null || end is null) {
                this.Add(UnmodeledReason.PlaneNotNamed, "$.forms", ("sketchPlane", sketchPlane),
                    ("start", start ?? ext.StartOffset.ToString("R", CultureInfo.InvariantCulture)),
                    ("end", end ?? ext.EndOffset.ToString("R", CultureInfo.InvariantCulture)));
                continue;
            }

            var slug = Unique(SlugFromPlanes(lockedTo) ?? (ext.IsSolid ? "extrusion" : "void"), result.ContainsKey);
            var identity = string.Join("|", lockedTo.OrderBy(x => x, StringComparer.Ordinal)) + "|" + sketchPlane;
            if (!planeSets.Add(identity)) this.Add(UnmodeledReason.IdentityNotUnique, $"$.forms.{slug}", ("identity", identity));
            var visibility = ext.GetVisibility();
            this._formSlug[ext.Id] = slug;
            result[slug] = new FamilyModelForm {
                Kind = FormKind.Extrusion,
                Void = ext.IsSolid ? null : true,
                Subcategory = ext.Subcategory?.Name,
                Material = this.Material(ext),
                Visible = this.Assoc(ext.get_Parameter(BuiltInParameter.IS_VISIBLE_PARAM)),
                Visibility = new FamilyModelVisibilityViews {
                    PlanRcp = visibility.IsShownInPlanRCPCut, FrontBack = visibility.IsShownInFrontBack, LeftRight = visibility.IsShownInLeftRight,
                    OnlyWhenCut = visibility.IsShownOnlyWhenCut, Coarse = visibility.IsShownInCoarse, Medium = visibility.IsShownInMedium, Fine = visibility.IsShownInFine
                },
                SketchPlane = sketchPlane,
                Profile = loops,
                Start = start,
                End = end
            };
        }

        return result;
    }

    private string? LockPlane(ElementId curveId) =>
        this._alignments.Where(a => a.Refs.Any(r => r.ElementId == curveId))
            .SelectMany(a => a.Refs.Where(r => r.ElementId != curveId).Select(r => this.NameOf(r)))
            .FirstOrDefault(n => n != null);

    private string? Material(Extrusion ext) {
        var p = ext.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM);
        if (p == null) return null;
        var assoc = this.Assoc(p);
        if (assoc != null) return assoc;
        var id = p.AsElementId();
        return id == null || id == ElementId.InvalidElementId ? null : this._d.GetElement(id)?.Name;
    }

    private static string? SlugFromPlanes(IReadOnlyList<string> planes) {
        if (planes.Count == 0) return null;
        var prefix = planes[0];
        foreach (var p in planes.Skip(1)) {
            var i = 0;
            while (i < prefix.Length && i < p.Length && prefix[i] == p[i]) i++;
            prefix = prefix[..i];
        }

        var slug = Slug(prefix.TrimEnd(' ', '(', '-', '.', '_'));
        return slug.Length == 0 ? null : slug;
    }

    // ───────────────────────────── nested ─────────────────────────────

    private Dictionary<string, FamilyModelNested> Nested(ISet<string> known) {
        var result = new Dictionary<string, FamilyModelNested>(StringComparer.Ordinal);
        var copies = Collect<LinearArray>().SelectMany(a => a.GetCopiedMemberIds()).SelectMany(this.MemberInstances).Select(i => i.Id).ToHashSet();
        foreach (var fi in Collect<FamilyInstance>().Where(f => f.Symbol?.Family != null && !copies.Contains(f.Id)).OrderBy(f => f.Id.Value())) {
            var family = fi.Symbol.Family.Name;
            var slug = Unique(Slug(family), result.ContainsKey);
            var host = this.HostOf(fi);
            if (host == null) {
                this.Add(UnmodeledReason.HingePlaneNotConstructible, $"$.nested.{slug}", ("family", family), ("type", fi.Symbol.Name),
                    ("host", fi.Host?.GetType().Name ?? "null"));
                continue;
            }

            var align = new List<FamilyModelAlign>();
            foreach (var (_, refs) in this._alignments.Where(a => a.Refs.Any(r => r.ElementId == fi.Id))) {
                var to = refs.Where(r => r.ElementId != fi.Id).Select(r => this.NameOf(r)).FirstOrDefault(n => n != null);
                var mine = refs.First(r => r.ElementId == fi.Id);
                var instance = this.NestedReferenceName(fi, mine);
                if (to == null || instance == null) {
                    this.Add(UnmodeledReason.DimensionToFace, $"$.nested.{slug}.align", ("instanceReference", StableOf(mine)), ("to", to ?? ""));
                    continue;
                }

                align.Add(new FamilyModelAlign { Instance = instance, To = to });
            }

            var associate = new Dictionary<string, string>(StringComparer.Ordinal);
            string? visible = null;
            foreach (var p in fi.Parameters.Cast<Parameter>().Concat(fi.Symbol.Parameters.Cast<Parameter>())) {
                var source = this.Assoc(p);
                if (source == null) continue;
                if ((p.Definition as InternalDefinition)?.BuiltInParameter == BuiltInParameter.IS_VISIBLE_PARAM) visible = source;
                else associate[p.Definition.Name] = source;
            }

            this._nestedSlug[fi.Id] = slug;
            result[slug] = new FamilyModelNested {
                Family = family,
                Type = fi.Symbol.Name,
                Host = host,
                Align = align.Count == 0 ? null : align,
                Associate = associate.Count == 0 ? null : associate,
                Visible = visible
            };
        }

        return result;
    }

    private string? HostOf(FamilyInstance fi) {
        if (fi.Host is ModelCurve line && this._planeName.TryGetValue(line.Id, out var lineName)) {
            if (fi.Location is not LocationPoint location) return null;
            if (location.Point.IsAlmostEqualTo(line.GeometryCurve.GetEndPoint(0))) return $"line:{lineName}.start";
            return location.Point.IsAlmostEqualTo(line.GeometryCurve.GetEndPoint(1)) ? $"line:{lineName}.end" : null;
        }
        if (fi.HostFace is { } face && this.NameOf(face) is { } faceName) return faceName;
        if (fi.Host != null && this._planeName.TryGetValue(fi.Host.Id, out var hostName)) return hostName;
        if (fi.LevelId != null && this._planeName.TryGetValue(fi.LevelId, out var level)) return level;
        var sketchPlane = fi.get_Parameter(BuiltInParameter.SKETCH_PLANE_PARAM);
        if (sketchPlane?.StorageType == StorageType.ElementId && this._planeName.TryGetValue(sketchPlane.AsElementId(), out var planeName))
            return planeName;
        var display = sketchPlane?.StorageType == StorageType.String ? sketchPlane.AsString() : null;
        // Native display text can be qualified (e.g. "Reference Plane: Name"); emit only a known plane name.
        var names = this._planeName.Values.Distinct(StringComparer.Ordinal)
            .Where(name => display == name || display?.EndsWith(": " + name, StringComparison.Ordinal) == true).ToArray();
        return names.Length == 1 ? names[0] : null;
    }

    /// <summary>
    ///     r2-revit claim 3: the host-side reference of a nested instance resolves to a
    ///     <see cref="FamilyInstanceReferenceType" /> with no `EditFamily`; the named strengths ARE the nested
    ///     plane's name. Only a Strong/Weak reference needs the nested document opened (read-only) to learn which
    ///     plane carries it.
    /// </summary>
    private string? NestedReferenceName(FamilyInstance fi, Reference mine) {
        var stable = StableOf(mine);
        foreach (FamilyInstanceReferenceType type in Enum.GetValues(typeof(FamilyInstanceReferenceType))) {
            if (type == FamilyInstanceReferenceType.NotAReference) continue;
            IList<Reference> refs;
            try { refs = fi.GetReferences(type); } catch { continue; }
            if (!refs.Any(r => StableOf(r) == stable)) continue;
            return type switch {
                FamilyInstanceReferenceType.CenterLeftRight => "Center (Left/Right)",
                FamilyInstanceReferenceType.CenterFrontBack => "Center (Front/Back)",
                FamilyInstanceReferenceType.CenterElevation => "Center (Elevation)",
                FamilyInstanceReferenceType.StrongReference or FamilyInstanceReferenceType.WeakReference =>
                    this.NestedPlaneNames(fi.Symbol.Family).FirstOrDefault(n => Try(() => StableOf(fi.GetReferenceByName(n)) == stable)) ?? type.ToString(),
                _ => type.ToString()
            };
        }

        return null;
    }

    private IReadOnlyList<string> NestedPlaneNames(Family family) {
        if (this._nestedPlaneNames.TryGetValue(family.Id, out var cached)) return cached;
        Document? nested = null;
        try {
            nested = this._d.EditFamily(family);
            cached = new FilteredElementCollector(nested).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .Select(p => p.Name).Where(n => !string.IsNullOrWhiteSpace(n)).Distinct(StringComparer.Ordinal).ToList();
        } catch (Exception ex) {
            this.Add(UnmodeledReason.HingePlaneNotConstructible, "$.nested", ("family", family.Name), ("editFamily", ex.Message));
            cached = [];
        } finally {
            nested?.Close(false);
        }

        return this._nestedPlaneNames[family.Id] = cached;
    }

    // ───────────────────────────── arrays ─────────────────────────────

    private Dictionary<string, FamilyModelArray> Arrays() {
        var result = new Dictionary<string, FamilyModelArray>(StringComparer.Ordinal);
        foreach (var radial in Collect<RadialArray>())
            this.Add(UnmodeledReason.ArrayRadial, "$.arrays", ("label", radial.Label?.Definition.Name ?? ""));
        foreach (var array in Collect<LinearArray>().OrderBy(a => a.Id.Value())) {
            var label = array.Label?.Definition.Name;
            if (label == null) {
                this.Add(UnmodeledReason.KindNotInVocabulary, "$.arrays", ("reason", "array has no label"), ("id", array.Id.Value().ToString(CultureInfo.InvariantCulture)));
                continue;
            }

            var original = array.GetOriginalMemberIds().SelectMany(this.MemberInstances).ToList();
            if (original.Count != 1 || !this._nestedSlug.TryGetValue(original[0].Id, out var member)) {
                this.Add(UnmodeledReason.ArrayMemberNotNested, "$.arrays", ("label", label), ("originalMembers", original.Count.ToString(CultureInfo.InvariantCulture)));
                continue;
            }

            var origin = PointOf(original[0]);
            var copies = array.GetCopiedMemberIds().SelectMany(this.MemberInstances)
                .Select(i => (Instance: i, Delta: PointOf(i) - origin)).OrderByDescending(x => x.Delta.GetLength()).ToList();
            if (copies.Count == 0 || origin == null) {
                this.Add(UnmodeledReason.ArrayAnchorNotObservable, "$.arrays", ("label", label), ("copiedMembers", "0"));
                continue;
            }

            var far = copies[0];
            var axis = ToAxis(far.Delta);
            if (axis == null) {
                this.Add(UnmodeledReason.PlaneNotAxisAligned, "$.arrays", ("label", label), ("direction", Fmt(far.Delta)));
                continue;
            }

            var spacingPlane = this._alignments.Where(a => a.Refs.Any(r => r.ElementId == far.Instance.Id))
                .SelectMany(a => a.Refs.Where(r => r.ElementId != far.Instance.Id).Select(r => this.NameOf(r))).FirstOrDefault(n => n != null);
            var slug = Unique($"{member}-{(spacingPlane != null ? Slug(spacingPlane) : axis.Value.ToString().ToLowerInvariant())}", result.ContainsKey);
            if (spacingPlane == null)
                this.Add(UnmodeledReason.ArrayAnchorNotObservable, $"$.arrays.{slug}", ("label", label), ("reason", "no alignment on the far copied member; pitch is a measurement"));
            result[slug] = new FamilyModelArray {
                Member = member,
                Direction = axis.Value,
                Label = $"param:{label}",
                MoveTo = spacingPlane != null ? ArrayAnchor.Last : ArrayAnchor.Second,
                SpacingPlane = spacingPlane,
                Spacing = spacingPlane != null ? null : PortableLength.FromFeet(Math.Round(copies[^1].Delta.GetLength(), 9))
            };
        }

        return result;
    }

    private IEnumerable<FamilyInstance> MemberInstances(ElementId id) => this._d.GetElement(id) switch {
        Group g => g.GetMemberIds().Select(this._d.GetElement).OfType<FamilyInstance>(),
        FamilyInstance fi => [fi],
        _ => []
    };

    // ───────────────────────────── connectors ─────────────────────────────

    private Dictionary<string, FamilyModelConnector> Connectors(ISet<string> known) {
        var result = new Dictionary<string, FamilyModelConnector>(StringComparer.Ordinal);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in Collect<ConnectorElement>().OrderBy(x => x.Id.Value())) {
            var domain = c.Domain switch {
                Domain.DomainHvac => (ConnectorDomain?)ConnectorDomain.Duct,
                Domain.DomainPiping => ConnectorDomain.Pipe,
                Domain.DomainElectrical => ConnectorDomain.Electrical,
                _ => null
            };
            var system = SystemTypeOf(c.SystemClassification);
            if (domain == null || system == null) {
                this.Add(UnmodeledReason.KindNotInVocabulary, "$.connectors", ("domain", c.Domain.ToString()), ("systemClassification", c.SystemClassification.ToString()));
                continue;
            }

            var normal = c.CoordinateSystem.BasisZ.Normalize();
            // kaitpw ruling 2026-09-06: a connector riding a nested instance's face is unmodeled, whatever plane
            // happens to be coplanar with it; the host names no plane for it.
            var nestedFace = this.NestedFaceUnder(c.Origin, normal);
            if (nestedFace != null) {
                this.Add(UnmodeledReason.ConnectorOnNestedFace, "$.connectors", ("domain", domain.ToString()!), ("systemType", system.ToString()!),
                    ("family", nestedFace.Symbol.Family.Name), ("instance", this._nestedSlug.TryGetValue(nestedFace.Id, out var nestedSlug) ? nestedSlug : ""), ("origin", Fmt(c.Origin)));
                continue;
            }

            var on = this.NamedPlanesThrough(c.Origin, p => Math.Abs(Math.Abs(p.Normal.DotProduct(normal)) - 1) < Tol).FirstOrDefault();
            if (on == null) {
                this.Add(UnmodeledReason.ConnectorFaceNotOnPlane, "$.connectors", ("domain", domain.ToString()!), ("systemType", system.ToString()!),
                    ("origin", Fmt(c.Origin)), ("normal", Fmt(normal)));
                continue;
            }

            var at = this.CrossingPlanesThrough(c.Origin, normal);
            if (at == null) {
                this.Add(UnmodeledReason.ConnectorFaceNotOnPlane, "$.connectors", ("domain", domain.ToString()!), ("on", on), ("origin", Fmt(c.Origin)), ("reason", "no two crossing planes through the origin"));
                continue;
            }

            var slug = Unique($"{domain}-{system}".ToLowerInvariant(), result.ContainsKey);
            var identity = $"{domain}|{on}|{string.Join("|", at.OrderBy(x => x, StringComparer.Ordinal))}";
            if (!keys.Add(identity)) {
                this.Add(UnmodeledReason.IdentityNotUnique, $"$.connectors.{slug}", ("identity", identity));
                continue;
            }

            var sizeParams = new[] { BuiltInParameter.CONNECTOR_DIAMETER, BuiltInParameter.CONNECTOR_RADIUS, BuiltInParameter.CONNECTOR_WIDTH, BuiltInParameter.CONNECTOR_HEIGHT };
            var associate = c.Parameters.Cast<Parameter>()
                .Where(p => !sizeParams.Contains((p.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID))
                .Select(p => (Name: p.Definition.Name, Source: this.Assoc(p)))
                .Where(x => x.Source != null)
                .ToDictionary(x => x.Name, x => x.Source!, StringComparer.Ordinal);
            var isDuct = domain == ConnectorDomain.Duct;
            var isPipe = domain == ConnectorDomain.Pipe;
            var flowDirection = c.get_Parameter(isDuct ? BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM : BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM);
            var flowConfiguration = c.get_Parameter(isDuct ? BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM : BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM);
            var loss = c.get_Parameter(isDuct ? BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM : BuiltInParameter.RBS_PIPE_FITTING_LOSS_METHOD_PARAM);
            var round = c.Shape == ConnectorProfileType.Round;
            result[slug] = new FamilyModelConnector {
                Domain = domain.Value,
                SystemType = system.Value,
                On = on,
                At = at,
                Shape = domain == ConnectorDomain.Electrical ? null : c.Shape switch {
                    ConnectorProfileType.Round => ConnectorShape.Round,
                    ConnectorProfileType.Rectangular => ConnectorShape.Rectangular,
                    ConnectorProfileType.Oval => ConnectorShape.Oval,
                    _ => null
                },
                Diameter = round && (isDuct || isPipe) ? this.LengthOf(c.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)) : null,
                Width = !round && (isDuct || isPipe) ? this.LengthOf(c.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)) : null,
                Height = !round && (isDuct || isPipe) ? this.LengthOf(c.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)) : null,
                FlowDirection = isDuct || isPipe ? EnumOf<FlowDirectionType, FlowDirection>(flowDirection) : null,
                FlowConfiguration = isDuct ? EnumOf<DuctFlowConfigurationType, FlowConfiguration>(flowConfiguration)
                    : isPipe ? EnumOf<PipeFlowConfigurationType, FlowConfiguration>(flowConfiguration) : null,
                LossMethod = isDuct ? EnumOf<DuctLossMethodType, LossMethod>(loss) : isPipe ? EnumOf<PipeLossMethodType, LossMethod>(loss) : null,
                Associate = associate.Count == 0 ? null : associate
            };
        }

        return result;
    }

    private static ConnectorSystemType? SystemTypeOf(MEPSystemClassification classification) {
        var name = classification switch {
            MEPSystemClassification.SupplyHydronic => "HydronicSupply",
            MEPSystemClassification.ReturnHydronic => "HydronicReturn",
            MEPSystemClassification.FireProtectWet => "FireProtectionWet",
            MEPSystemClassification.FireProtectDry => "FireProtectionDry",
            MEPSystemClassification.FireProtectPreaction => "FireProtectionPreAction",
            MEPSystemClassification.FireProtectOther => "FireProtectionOther",
            _ => classification.ToString()
        };
        return Enum.TryParse<ConnectorSystemType>(name, out var v) ? v : null;
    }

    private static TOut? EnumOf<TIn, TOut>(Parameter? p) where TIn : struct, Enum where TOut : struct, Enum =>
        p == null || p.StorageType != StorageType.Integer ? null
        : Enum.TryParse<TOut>(((TIn)(object)p.AsInteger()).ToString(), out var v) ? v : null;

    private FamilyInstance? NestedFaceUnder(XYZ point, XYZ normal) {
        var options = new Options { DetailLevel = ViewDetailLevel.Fine };
        foreach (var fi in Collect<FamilyInstance>().Where(f => f.Symbol?.Family != null)) {
            var geometry = fi.get_Geometry(options);
            if (geometry == null) continue;
            var solids = geometry.SelectMany(g => g is GeometryInstance gi ? gi.GetInstanceGeometry().OfType<Solid>() : g is Solid s ? [s] : []);
            if (solids.SelectMany(s => s.Faces.OfType<PlanarFace>()).Any(f =>
                    Math.Abs(Math.Abs(f.FaceNormal.DotProduct(normal)) - 1) < Tol && Math.Abs((point - f.Origin).DotProduct(f.FaceNormal)) < FaceTol &&
                    Try(() => f.Project(point)?.Distance < FaceTol)))
                return fi;
        }

        return null;
    }

    // ───────────────────────────── settings, lookup tables, room point, template ─────────────────────────────

    private FamilyModelSettings? Settings() {
        var family = this._d.OwnerFamily;
        var alwaysVertical = Bool(family, BuiltInParameter.FAMILY_ALWAYS_VERTICAL);
        var shared = Bool(family, BuiltInParameter.FAMILY_SHARED);
        var cutWithVoids = Bool(family, BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS);
#if REVIT2026_OR_GREATER
        string? omniClass = null; // Revit 2026 replaced OMNICLASS_CODE with ClassificationEntries; a different shape, not read here.
#else
        var omniClass = family.get_Parameter(BuiltInParameter.OMNICLASS_CODE)?.AsString();
#endif
        var settings = new FamilyModelSettings {
            AlwaysVertical = alwaysVertical,
            Shared = shared == true ? true : null,
            CutWithVoidsWhenLoaded = cutWithVoids == true ? true : null,
            PartType = this.PartType(family),
            OmniClass = string.IsNullOrWhiteSpace(omniClass) ? null : omniClass
        };
        return settings.AlwaysVertical == null && settings.Shared == null && settings.CutWithVoidsWhenLoaded == null &&
               settings.PartType == null && settings.OmniClass == null
            ? null
            : settings;
    }

    private static bool? Bool(Element e, BuiltInParameter bip) {
        var p = e.get_Parameter(bip);
        return p == null || p.StorageType != StorageType.Integer ? null : p.AsInteger() != 0;
    }

    private FamilyPartType? PartType(Family family) {
        var p = family.get_Parameter(BuiltInParameter.FAMILY_CONTENT_PART_TYPE);
        if (p == null || p.StorageType != StorageType.Integer) return null;
        var value = p.AsInteger();
        if (Enum.IsDefined(typeof(PartType), value) && Enum.TryParse<FamilyPartType>(((PartType)value).ToString(), out var portable)) return portable;
        this.Add(UnmodeledReason.PartTypeNotPortable, "$.settings.partType", ("storedValue", value.ToString(CultureInfo.InvariantCulture)));
        return null;
    }

    private Dictionary<string, FamilyModelLookupTable> LookupTables(FamilySnapshot snapshot) {
        var tables = new Dictionary<string, FamilyModelLookupTable>(StringComparer.Ordinal);
        foreach (var table in snapshot.LookupTables?.Data ?? []) {
            var name = table.Schema?.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name)) {
                this.Add(UnmodeledReason.LookupTableUnreadable, "$.lookupTables", ("rows", table.Rows.Count.ToString(CultureInfo.InvariantCulture)), ("reason", "no name"));
                continue;
            }

            try {
                tables[name!] = new FamilyModelLookupTable { Csv = LookupTableCsvCodec.Encode(table) };
            } catch (InvalidOperationException ex) {
                this.Add(UnmodeledReason.LookupTableUnreadable, $"$.lookupTables.{name}", ("reason", ex.Message));
            }
        }

        return tables;
    }

    private FamilyModelRoomCalculationPoint? RoomCalculationPoint(FamilyModelPlacement placement) {
        if (!this._d.OwnerFamily.ShowSpatialElementCalculationPoint) return null;
        var direction = placement == FamilyModelPlacement.OneLevelBasedHosted ? new XYZ(0, -1, 0) : XYZ.BasisZ;
        var single = Collect<SpatialElementCalculationPoint>().ToList();
        var fromTo = Collect<SpatialElementFromToCalculationPoints>().ToList();
        var onAxis = single.Count + fromTo.Count > 0 &&
                     single.All(p => Along(p.Position, direction)) &&
                     fromTo.All(p => Along(p.FromPosition, direction.Negate()) && Along(p.ToPosition, direction));
        if (!onAxis)
            this.Add(UnmodeledReason.RoomPointNotOnAxis, "$.roomCalculationPoint", ("placement", placement.ToString()),
                ("singlePoints", single.Count.ToString(CultureInfo.InvariantCulture)), ("fromToPoints", fromTo.Count.ToString(CultureInfo.InvariantCulture)));
        var offset = single.Select(p => p.Position.GetLength()).Concat(fromTo.Select(p => p.ToPosition.GetLength())).DefaultIfEmpty(PeRoomCalculationOffsetFeet).First();
        return new FamilyModelRoomCalculationPoint {
            Enabled = true,
            Offset = Math.Abs(offset - PeRoomCalculationOffsetFeet) < 1e-9 ? null : PortableLength.FromFeet(Math.Round(offset, 9))
        };
    }

    private static bool Along(XYZ position, XYZ direction) =>
        position.GetLength() > 1e-9 && position.Normalize().IsAlmostEqualTo(direction.Normalize(), Tol);

    private string InferTemplate(FamilyCategory category, FamilyModelPlacement placement) {
        // Revit keeps no .rft path in an .rfa; only proven category+placement conventions name a template.
        var generic = category is FamilyCategory.GenericModels or FamilyCategory.AirTerminals;
        var template = (placement, generic, category) switch {
            (FamilyModelPlacement.OneLevelBased, true, _) => "Generic Model",
            (FamilyModelPlacement.WorkPlaneBased, true, _) => "Generic Model face based",
            (FamilyModelPlacement.OneLevelBasedHosted, _, FamilyCategory.PlumbingFixtures) => "Plumbing Fixture wall based",
            (FamilyModelPlacement.OneLevelBasedHosted, _, FamilyCategory.GenericModels) => "Generic Model wall based",
            _ => null
        };
        if (template != null) return template;
        this.Add(UnmodeledReason.TemplateUnknown, "$.family.template", ("category", category.ToString()), ("placement", placement.ToString()));
        return "Unknown";
    }

    // ───────────────────────────── reference and plane helpers ─────────────────────────────

    private string? NameOf(Reference r) => this._planeName.TryGetValue(r.ElementId, out var n) ? n : null;

    private string Describe(Reference r) {
        var e = this._d.GetElement(r.ElementId);
        return $"{e?.GetType().Name}<{e?.Name}> {StableOf(r)}";
    }

    private string StableOf(Reference r) => Try(() => r.ConvertToStableRepresentation(this._d)) ?? string.Empty;

    private string? Assoc(Parameter? p) {
        if (p == null) return null;
        var source = Try(() => this._fm.GetAssociatedFamilyParameter(p));
        return source == null ? null : $"param:{source.Definition.Name}";
    }

    private string? Length(Parameter? p) => this.LengthOf(p)?.Text;

    private PortableLength? LengthOf(Parameter? p) {
        if (p == null) return null;
        var assoc = this.Assoc(p);
        if (assoc != null) return PortableLength.Parse(assoc);
        return p.StorageType == StorageType.Double ? PortableLength.FromFeet(Math.Round(p.AsDouble(), 9)) : null;
    }

    private sealed record NamedPlane(string Name, XYZ Origin, XYZ Normal, bool IsDatum);

    private IEnumerable<NamedPlane> NamedPlanes() {
        foreach (var level in this._levels)
            yield return new NamedPlane(this._planeName[level.Id], new XYZ(0, 0, level.ProjectElevation), XYZ.BasisZ, true);
        foreach (var rp in this._refPlanes) {
            if (!this._planeName.TryGetValue(rp.Id, out var name)) continue;
            yield return new NamedPlane(name, rp.GetPlane().Origin, rp.Normal.Normalize(),
                rp.get_Parameter(BuiltInParameter.DATUM_PLANE_DEFINES_ORIGIN)?.AsInteger() == 1);
        }
    }

    /// <summary>Named planes containing <paramref name="point" />, datums first then by name, filtered by <paramref name="where" />.</summary>
    private List<string> NamedPlanesThrough(XYZ point, Func<NamedPlane, bool> where) =>
        this.NamedPlanes().Where(p => Math.Abs((point - p.Origin).DotProduct(p.Normal)) < FaceTol && where(p))
            .OrderByDescending(p => p.IsDatum).ThenBy(p => p.Name, StringComparer.Ordinal).Select(p => p.Name).ToList();

    /// <summary>Two named planes through <paramref name="point" />, both containing <paramref name="axis" />, with crossing normals.</summary>
    private List<string>? CrossingPlanesThrough(XYZ point, XYZ axis) {
        var candidates = this.NamedPlanes().Where(p => Math.Abs(p.Normal.DotProduct(axis)) < Tol && Math.Abs((point - p.Origin).DotProduct(p.Normal)) < FaceTol)
            .OrderByDescending(p => p.IsDatum).ThenBy(p => p.Name, StringComparer.Ordinal).ToList();
        foreach (var a in candidates) {
            var b = candidates.FirstOrDefault(x => Math.Abs(Math.Abs(x.Normal.DotProduct(a.Normal)) - 1) > Tol);
            if (b != null) return [a.Name, b.Name];
        }

        return null;
    }

    private static XYZ? PointOf(FamilyInstance fi) => (fi.Location as LocationPoint)?.Point;

    private static bool SameCurve(Curve? a, Curve b) {
        if (a == null || a.GetType() != b.GetType()) return false;
        if (a is Arc arcA && b is Arc arcB && !arcA.IsBound && !arcB.IsBound)
            return arcA.Center.IsAlmostEqualTo(arcB.Center, FaceTol) && Math.Abs(arcA.Radius - arcB.Radius) < FaceTol;
        if (!a.IsBound || !b.IsBound) return false;
        var (a0, a1, b0, b1) = (a.GetEndPoint(0), a.GetEndPoint(1), b.GetEndPoint(0), b.GetEndPoint(1));
        return (a0.IsAlmostEqualTo(b0, FaceTol) && a1.IsAlmostEqualTo(b1, FaceTol)) || (a0.IsAlmostEqualTo(b1, FaceTol) && a1.IsAlmostEqualTo(b0, FaceTol));
    }

    private static string? SafeLabel(Dimension dim) => Try(() => dim.FamilyLabel)?.Definition.Name;

    private static RefStrength? Strength(int? value) => value switch {
        0 => RefStrength.Left, 1 => RefStrength.CenterLeftRight, 2 => RefStrength.Right, 3 => RefStrength.Front,
        4 => RefStrength.CenterFrontBack, 5 => RefStrength.Back, 6 => RefStrength.Bottom, 7 => RefStrength.CenterElevation,
        8 => RefStrength.Top, 13 => RefStrength.StrongReference, 14 => RefStrength.WeakReference,
        _ => null // 12 = Not a Reference, the portable default
    };

    private static Axis? ToAxis(XYZ v) {
        if (v.GetLength() < Tol) return null;
        var n = v.Normalize();
        if (Math.Abs(Math.Abs(n.X) - 1) < Tol) return n.X > 0 ? Axis.PlusX : Axis.MinusX;
        if (Math.Abs(Math.Abs(n.Y) - 1) < Tol) return n.Y > 0 ? Axis.PlusY : Axis.MinusY;
        if (Math.Abs(Math.Abs(n.Z) - 1) < Tol) return n.Z > 0 ? Axis.PlusZ : Axis.MinusZ;
        return null;
    }

    private IEnumerable<T> Collect<T>() where T : Element => new FilteredElementCollector(this._d).OfClass(typeof(T)).Cast<T>();

    private void Add(UnmodeledReason reason, string path, params (string Key, string Value)[] facts) =>
        this._un.Add(FamilyModelParameterProjection.Fact(reason, path, facts));

    private static string Unique(string slug, Func<string, bool> taken) {
        if (!taken(slug)) return slug;
        for (var i = 2; ; i++)
            if (!taken($"{slug}-{i}")) return $"{slug}-{i}";
    }

    private static string Slug(string value) =>
        string.Join("-", new string(value.Trim().Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray())
            .Split(['-'], StringSplitOptions.RemoveEmptyEntries));

    private static string Fmt(XYZ p) => FormattableString.Invariant($"({p.X:0.####},{p.Y:0.####},{p.Z:0.####})");

    private static T? Try<T>(Func<T> f) {
        try { return f(); } catch { return default; }
    }
}
