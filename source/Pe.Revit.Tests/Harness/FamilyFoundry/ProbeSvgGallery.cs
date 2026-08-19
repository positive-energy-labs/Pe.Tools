using System.Globalization;
using System.Text;

namespace Pe.Revit.Tests;

/// <summary>
///     Projects one runtime probe to a single self-contained SVG with three orthographic views, so a human
///     can judge placement without opening the RFA.
/// </summary>
/// <remarks>
///     <para>
///         Numbers in a failure message say which coordinate disagrees. They do not say that a family looks
///         wrong while every assertion passes. This gallery is the eyeball lane beside the oracle: plan,
///         front, and right, in one file, drawn from Revit-side readings only.
///     </para>
///     <para>
///         The drawing is a projection of the probe, not of the portable document. It therefore shows what
///         Revit built. All three views share one scale, so relative size is readable across views.
///     </para>
///     <para>
///         Deliberate simplification: extrusions are drawn from their bounding boxes, so a rotated or
///         non-rectangular form would read as its box. The v1 vocabulary has no such form.
///     </para>
/// </remarks>
internal static class ProbeSvgGallery {
    private const double PanelSize = 300;
    private const double PanelGap = 28;
    private const double Margin = 24;
    private const double HeaderHeight = 54;
    private const double ScaleBarHeight = 34;
    private const double MinimumHalfSpan = 0.25;

    private static readonly (double Feet, string Label)[] ScaleBarSteps = [
        (1.0 / 12.0, "1\""), (0.25, "3\""), (0.5, "6\""), (1, "1'"), (2, "2'"), (5, "5'"), (10, "10'")
    ];

    /// <summary>
    ///     Writes `&lt;familyName&gt;/&lt;typeName&gt;.svg` under <paramref name="directory" /> and returns
    ///     the full path. The caller owns the run directory, including its date.
    /// </summary>
    public static string Write(string directory, string familyName, RuntimeStateProbe probe) {
        var familyDirectory = Path.Combine(directory, SanitizeName(familyName));
        _ = Directory.CreateDirectory(familyDirectory);
        var path = Path.Combine(familyDirectory, $"{SanitizeName(probe.TypeName)}.svg");
        File.WriteAllText(path, Render(familyName, probe), Encoding.UTF8);
        return path;
    }

    private static string Render(string familyName, RuntimeStateProbe probe) {
        var window = MeasureWindow(probe);
        var scale = PanelSize / (2 * window.HalfSpan * 1.1);
        var width = (2 * Margin) + (3 * PanelSize) + (2 * PanelGap);
        var height = (2 * Margin) + HeaderHeight + PanelSize + ScaleBarHeight;

        var svg = new StringBuilder();
        _ = svg.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
            .Append($"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{N(width)}\" height=\"{N(height)}\" ")
            .Append($"viewBox=\"0 0 {N(width)} {N(height)}\">\n")
            .Append("<style>\n")
            .Append("  text { font-family: ui-monospace, Consolas, monospace; fill: #1b1b1b; }\n")
            .Append("  .title { font-size: 16px; font-weight: 600; }\n")
            .Append("  .sub { font-size: 11px; fill: #5a5a5a; }\n")
            .Append("  .panel-title { font-size: 11px; font-weight: 600; }\n")
            .Append("  .frame { fill: none; stroke: #d0d0d0; stroke-width: 1; }\n")
            .Append("  .solid { fill: #2f6f9f22; stroke: #2f6f9f; stroke-width: 1.4; }\n")
            .Append("  .void { fill: none; stroke: #b04a3c; stroke-width: 1.2; stroke-dasharray: 5 3; }\n")
            .Append("  .plane { stroke: #9a9a9a; stroke-width: 0.5; stroke-dasharray: 2 3; }\n")
            .Append("  .plane-label { font-size: 8px; fill: #7a7a7a; }\n")
            .Append("  .axis { stroke: #c8c8c8; stroke-width: 0.75; }\n")
            .Append("  .connector { fill: #7a4fbf; stroke: none; }\n")
            .Append("  .connector-arrow { stroke: #7a4fbf; stroke-width: 1.2; fill: none; }\n")
            .Append("  .bar { stroke: #1b1b1b; stroke-width: 1.5; }\n")
            .Append("  .bar-label { font-size: 10px; }\n")
            .Append("</style>\n")
            .Append($"<rect x=\"0\" y=\"0\" width=\"{N(width)}\" height=\"{N(height)}\" fill=\"#ffffff\"/>\n")
            .Append($"<text class=\"title\" x=\"{N(Margin)}\" y=\"{N(Margin + 16)}\">{Escape(familyName)}</text>\n")
            .Append($"<text class=\"sub\" x=\"{N(Margin)}\" y=\"{N(Margin + 33)}\">type {Escape(probe.TypeName)} ")
            .Append($"&#183; {probe.Prisms.Count} prisms &#183; {probe.Cylinders.Count} cylinders &#183; ")
            .Append($"{probe.Connectors.Count} connectors &#183; {probe.Planes.Count} reference planes ")
            .Append("&#183; feet</text>\n");

        var views = new[] {
            new GalleryView("Plan (+Z)", "X right", "Y up", Axis.X, Axis.Y, Axis.Z),
            new GalleryView("Front (-Y)", "X right", "Z up", Axis.X, Axis.Z, Axis.Y),
            new GalleryView("Right (+X)", "Y right", "Z up", Axis.Y, Axis.Z, Axis.X)
        };

        for (var index = 0; index < views.Length; index++) {
            var origin = Margin + (index * (PanelSize + PanelGap));
            _ = svg.Append(RenderPanel(views[index], probe, window, scale, origin, Margin + HeaderHeight));
        }

        _ = svg.Append(RenderScaleBar(scale, Margin, Margin + HeaderHeight + PanelSize + 20));
        _ = svg.Append("</svg>\n");
        return svg.ToString();
    }

    private static string RenderPanel(
        GalleryView view,
        RuntimeStateProbe probe,
        GalleryWindow window,
        double scale,
        double left,
        double top
    ) {
        var panel = new StringBuilder();
        _ = panel.Append($"<g><text class=\"panel-title\" x=\"{N(left)}\" y=\"{N(top - 8)}\">")
            .Append($"{Escape(view.Title)} &#160; <tspan class=\"sub\">{Escape(view.HorizontalLabel)} ")
            .Append($"{Escape(view.VerticalLabel)}</tspan></text>\n")
            .Append($"<rect class=\"frame\" x=\"{N(left)}\" y=\"{N(top)}\" ")
            .Append($"width=\"{N(PanelSize)}\" height=\"{N(PanelSize)}\"/>\n");

        var projector = new GalleryProjector(view, window, scale, left + (PanelSize / 2), top + (PanelSize / 2));
        var originX = projector.ToScreenHorizontal(0);
        var originY = projector.ToScreenVertical(0);
        _ = panel.Append($"<line class=\"axis\" x1=\"{N(left)}\" y1=\"{N(originY)}\" ")
            .Append($"x2=\"{N(left + PanelSize)}\" y2=\"{N(originY)}\"/>\n")
            .Append($"<line class=\"axis\" x1=\"{N(originX)}\" y1=\"{N(top)}\" ")
            .Append($"x2=\"{N(originX)}\" y2=\"{N(top + PanelSize)}\"/>\n");

        foreach (var plane in probe.Planes.Values.OrderBy(item => item.Name, StringComparer.Ordinal))
            _ = panel.Append(RenderPlaneTrace(plane, view, projector, left, top));

        foreach (var prism in probe.Prisms) {
            _ = panel.Append(RenderBox(
                projector,
                prism.Min.X, prism.Min.Y, prism.Min.Z,
                prism.Max.X, prism.Max.Y, prism.Max.Z,
                prism.IsSolid));
        }

        foreach (var cylinder in probe.Cylinders) {
            // In plan a cylinder is its true circle; in elevation the bounding box is the honest silhouette.
            if (view.ViewAxis == Axis.Z) {
                var centerX = projector.ToScreenHorizontal(
                    (Component(cylinder.Min, view.Horizontal) + Component(cylinder.Max, view.Horizontal)) / 2);
                var centerY = projector.ToScreenVertical(
                    (Component(cylinder.Min, view.Vertical) + Component(cylinder.Max, view.Vertical)) / 2);
                _ = panel.Append($"<circle class=\"{(cylinder.IsSolid ? "solid" : "void")}\" ")
                    .Append($"cx=\"{N(centerX)}\" cy=\"{N(centerY)}\" ")
                    .Append($"r=\"{N(cylinder.Diameter / 2 * scale)}\"/>\n");
                continue;
            }

            _ = panel.Append(RenderBox(
                projector,
                cylinder.Min.X, cylinder.Min.Y, cylinder.Min.Z,
                cylinder.Max.X, cylinder.Max.Y, cylinder.Max.Z,
                cylinder.IsSolid));
        }

        foreach (var connector in probe.Connectors) {
            var x = projector.ToScreenHorizontal(Component(connector.Origin, view.Horizontal));
            var y = projector.ToScreenVertical(Component(connector.Origin, view.Vertical));
            var normalHorizontal = Component(connector.FaceNormal, view.Horizontal);
            var normalVertical = Component(connector.FaceNormal, view.Vertical);
            _ = panel.Append($"<circle class=\"connector\" cx=\"{N(x)}\" cy=\"{N(y)}\" r=\"2.6\"/>\n");
            var length = Math.Sqrt((normalHorizontal * normalHorizontal) + (normalVertical * normalVertical));
            if (length <= 1e-9)
                continue;

            // The arrow is a fixed screen length. It shows direction only; magnitude is meaningless here.
            var tipX = x + (normalHorizontal / length * 18);
            var tipY = y - (normalVertical / length * 18);
            _ = panel.Append($"<line class=\"connector-arrow\" x1=\"{N(x)}\" y1=\"{N(y)}\" ")
                .Append($"x2=\"{N(tipX)}\" y2=\"{N(tipY)}\"/>\n")
                .Append($"<circle class=\"connector\" cx=\"{N(tipX)}\" cy=\"{N(tipY)}\" r=\"1.6\"/>\n");
        }

        _ = panel.Append("</g>\n");
        return panel.ToString();
    }

    private static string RenderPlaneTrace(
        RuntimePlaneProbe plane,
        GalleryView view,
        GalleryProjector projector,
        double left,
        double top
    ) {
        var axis = DominantAxis(plane.Normal);
        // A plane normal to the view direction is face-on and has no trace. A plane that is not axis
        // aligned is outside the v1 vocabulary and is skipped rather than drawn as a guess.
        if (axis == null || axis == view.ViewAxis)
            return string.Empty;

        if (axis == view.Horizontal) {
            var x = projector.ToScreenHorizontal(Component(plane.Midpoint, view.Horizontal));
            return $"<line class=\"plane\" x1=\"{N(x)}\" y1=\"{N(top)}\" x2=\"{N(x)}\" y2=\"{N(top + PanelSize)}\"/>\n" +
                   $"<text class=\"plane-label\" x=\"{N(x + 2)}\" y=\"{N(top + PanelSize - 4)}\">" +
                   $"{Escape(plane.Name)}</text>\n";
        }

        var y = projector.ToScreenVertical(Component(plane.Midpoint, view.Vertical));
        return $"<line class=\"plane\" x1=\"{N(left)}\" y1=\"{N(y)}\" x2=\"{N(left + PanelSize)}\" y2=\"{N(y)}\"/>\n" +
               $"<text class=\"plane-label\" x=\"{N(left + 3)}\" y=\"{N(y - 2)}\">{Escape(plane.Name)}</text>\n";
    }

    private static string RenderBox(
        GalleryProjector projector,
        double minX,
        double minY,
        double minZ,
        double maxX,
        double maxY,
        double maxZ,
        bool isSolid
    ) {
        var view = projector.View;
        var minimum = new[] { minX, minY, minZ };
        var maximum = new[] { maxX, maxY, maxZ };
        var horizontalLow = projector.ToScreenHorizontal(minimum[(int)view.Horizontal]);
        var horizontalHigh = projector.ToScreenHorizontal(maximum[(int)view.Horizontal]);
        var verticalLow = projector.ToScreenVertical(minimum[(int)view.Vertical]);
        var verticalHigh = projector.ToScreenVertical(maximum[(int)view.Vertical]);
        return $"<rect class=\"{(isSolid ? "solid" : "void")}\" x=\"{N(Math.Min(horizontalLow, horizontalHigh))}\" " +
               $"y=\"{N(Math.Min(verticalLow, verticalHigh))}\" " +
               $"width=\"{N(Math.Abs(horizontalHigh - horizontalLow))}\" " +
               $"height=\"{N(Math.Abs(verticalHigh - verticalLow))}\"/>\n";
    }

    private static string RenderScaleBar(double scale, double left, double top) {
        var candidates = ScaleBarSteps.Where(candidate => candidate.Feet * scale <= PanelSize / 3).ToList();
        var step = candidates.Count > 0 ? candidates[candidates.Count - 1] : ScaleBarSteps[0];
        var length = step.Feet * scale;
        return $"<g><line class=\"bar\" x1=\"{N(left)}\" y1=\"{N(top)}\" x2=\"{N(left + length)}\" y2=\"{N(top)}\"/>\n" +
               $"<line class=\"bar\" x1=\"{N(left)}\" y1=\"{N(top - 4)}\" x2=\"{N(left)}\" y2=\"{N(top + 4)}\"/>\n" +
               $"<line class=\"bar\" x1=\"{N(left + length)}\" y1=\"{N(top - 4)}\" " +
               $"x2=\"{N(left + length)}\" y2=\"{N(top + 4)}\"/>\n" +
               $"<text class=\"bar-label\" x=\"{N(left + length + 8)}\" y=\"{N(top + 4)}\">" +
               $"{Escape(step.Label)} (all views)</text></g>\n";
    }

    /// <summary>
    ///     One cube-shaped world window centered on the geometry, so the three views share a scale and a
    ///     center. Planes contribute only their coordinate along their own normal; a reference plane is
    ///     infinite and its Revit origin must not stretch the window.
    /// </summary>
    private static GalleryWindow MeasureWindow(RuntimeStateProbe probe) {
        var minimum = new[] { double.MaxValue, double.MaxValue, double.MaxValue };
        var maximum = new[] { double.MinValue, double.MinValue, double.MinValue };
        var measured = false;

        void Include(int axis, double value) {
            minimum[axis] = Math.Min(minimum[axis], value);
            maximum[axis] = Math.Max(maximum[axis], value);
            measured = true;
        }

        void IncludePoint(XYZ point) {
            Include(0, point.X);
            Include(1, point.Y);
            Include(2, point.Z);
        }

        foreach (var prism in probe.Prisms) {
            IncludePoint(prism.Min);
            IncludePoint(prism.Max);
        }

        foreach (var cylinder in probe.Cylinders) {
            IncludePoint(cylinder.Min);
            IncludePoint(cylinder.Max);
        }

        foreach (var connector in probe.Connectors)
            IncludePoint(connector.Origin);

        foreach (var plane in probe.Planes.Values) {
            var axis = DominantAxis(plane.Normal);
            if (axis != null)
                Include((int)axis.Value, Component(plane.Midpoint, axis.Value));
        }

        if (!measured)
            return new GalleryWindow(0, 0, 0, MinimumHalfSpan);

        var centers = new double[3];
        var halfSpan = MinimumHalfSpan;
        for (var axis = 0; axis < 3; axis++) {
            // An axis with no geometry keeps the family origin and does not stretch the shared window.
            if (minimum[axis] > maximum[axis])
                continue;

            centers[axis] = (minimum[axis] + maximum[axis]) / 2;
            halfSpan = Math.Max(halfSpan, (maximum[axis] - minimum[axis]) / 2);
        }

        return new GalleryWindow(centers[0], centers[1], centers[2], halfSpan);
    }

    private static Axis? DominantAxis(XYZ normal) {
        if (Math.Abs(Math.Abs(normal.X) - 1) < 1e-6)
            return Axis.X;
        if (Math.Abs(Math.Abs(normal.Y) - 1) < 1e-6)
            return Axis.Y;
        return Math.Abs(Math.Abs(normal.Z) - 1) < 1e-6 ? Axis.Z : null;
    }

    private static double Component(XYZ point, Axis axis) => axis switch {
        Axis.X => point.X,
        Axis.Y => point.Y,
        _ => point.Z
    };

    private static string SanitizeName(string name) {
        var sanitized = string.Concat(name.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character)).Trim();
        return string.IsNullOrEmpty(sanitized) ? "unnamed" : sanitized;
    }

    private static string Escape(string text) => text
        .Replace("&", "&amp;")
        .Replace("<", "&lt;")
        .Replace(">", "&gt;")
        .Replace("\"", "&quot;");

    private static string N(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

    private enum Axis {
        X = 0,
        Y = 1,
        Z = 2
    }

    private sealed record GalleryView(
        string Title,
        string HorizontalLabel,
        string VerticalLabel,
        Axis Horizontal,
        Axis Vertical,
        Axis ViewAxis
    );

    private readonly record struct GalleryWindow(double CenterX, double CenterY, double CenterZ, double HalfSpan) {
        public double Center(Axis axis) => axis switch {
            Axis.X => this.CenterX,
            Axis.Y => this.CenterY,
            _ => this.CenterZ
        };
    }

    private sealed record GalleryProjector(
        GalleryView View,
        GalleryWindow Window,
        double Scale,
        double PanelCenterX,
        double PanelCenterY
    ) {
        public double ToScreenHorizontal(double world) =>
            this.PanelCenterX + ((world - this.Window.Center(this.View.Horizontal)) * this.Scale);

        public double ToScreenVertical(double world) =>
            this.PanelCenterY - ((world - this.Window.Center(this.View.Vertical)) * this.Scale);
    }
}
