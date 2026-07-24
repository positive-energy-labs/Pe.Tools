using Pe.Revit.DocumentData.AgentContext;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Glance;

/// <summary>
///     "What is on the user's screen right now, and can pea trust it" — composes the
///     active-view stage, visible category composition (counts only, generous bounds),
///     and the rendering-state trust strip into one packet. Server-side promotion of
///     the client glance.attention prototype; envelope per docs/adr/0003.
/// </summary>
public static class GlanceAttentionCollector {
    public static GlanceAttentionData Collect(Document document, View? activeView) {
        var issues = new List<RevitDataIssue>();

        var visible = RevitAgentContextCollector.CollectVisibleContext(
            document,
            activeView,
            new RevitAgentVisibleContextRequest(MaxCategories: 24)
        );
        issues.AddRange(visible.Issues);

        var rendering = RevitAgentContextCollector.CollectViewRenderingState(
            document,
            activeView,
            new RevitAgentViewRenderingStateRequest()
        );
        issues.AddRange(rendering.Issues);

        return new GlanceAttentionData(
            DateTime.UtcNow.ToString("o"),
            activeView == null ? null : RevitAgentContextCollector.CreateActiveViewContext(document, activeView),
            rendering.ObservedState.FirstOrDefault(),
            visible.TotalVisibleElementCount,
            visible.Categories,
            rendering.ConfidenceWarnings,
            rendering.ApiLimitations,
            rendering.NotInspected,
            issues
        );
    }
}
