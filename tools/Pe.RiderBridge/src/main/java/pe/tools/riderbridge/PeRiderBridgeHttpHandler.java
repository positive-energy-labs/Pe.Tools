package pe.tools.riderbridge;

import com.intellij.execution.ProgramRunnerUtil;
import com.intellij.execution.RunManager;
import com.intellij.execution.configurations.RuntimeConfigurationException;
import com.intellij.execution.executors.DefaultDebugExecutor;
import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionPlaces;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.actionSystem.DataContext;
import com.intellij.openapi.actionSystem.ex.ActionUtil;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManager;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelFutureListener;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.FullHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpHeaderValues;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.handler.codec.http.QueryStringDecoder;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.ide.HttpRequestHandler;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

public final class PeRiderBridgeHttpHandler extends HttpRequestHandler {
    private static final String Prefix = "/pe-tools";
    private static final String[] DefaultHotReloadActions = {
        "ActivateCommitToolWindow",
        "Synchronize",
        "RiderDebuggerApplyEncChagnes"
    };
    private static final String[] DiagnosticActionIds = {
        "Synchronize",
        "RiderDebuggerApplyEncChagnes",
        "Rerun",
        "Debug",
        "Stop"
    };
    private static final String DefaultRestartConfigurationName = "Pe.App";
    private static final String BridgeVersion = "0.1.0-direct-run-configuration";
    private static final String RestartStrategy = "rerun-action-then-debug-run-configuration";

    @Override
    public boolean isSupported(@NotNull FullHttpRequest request) {
        return request.uri().startsWith(Prefix + "/");
    }

    @Override
    public boolean process(
        @NotNull QueryStringDecoder urlDecoder,
        @NotNull FullHttpRequest request,
        @NotNull ChannelHandlerContext context
    ) throws IOException {
        if (!isLocalHost(request)) {
            send(context, HttpResponseStatus.FORBIDDEN, "{\"ok\":false,\"error\":\"localhost only\"}");
            return true;
        }

        var path = urlDecoder.path();
        if (path.equals(Prefix + "/ping")) {
            send(context, HttpResponseStatus.OK, "{\"ok\":true,\"bridge\":\"Pe.RiderBridge\",\"version\":\"" + json(BridgeVersion) + "\",\"restartStrategy\":\"" + json(RestartStrategy) + "\"}");
            return true;
        }

        if (!request.method().equals(HttpMethod.POST)) {
            send(context, HttpResponseStatus.METHOD_NOT_ALLOWED, "{\"ok\":false,\"error\":\"POST required\"}");
            return true;
        }

        var query = urlDecoder.parameters();
        var project = selectProject(first(query, "project"));
        if (project == null) {
            send(context, HttpResponseStatus.NOT_FOUND, "{\"ok\":false,\"error\":\"No open matching project\"}");
            return true;
        }

        if (path.equals(Prefix + "/actions/invoke")) {
            var actionId = first(query, "actionId");
            if (actionId == null || actionId.isBlank()) {
                send(context, HttpResponseStatus.BAD_REQUEST, "{\"ok\":false,\"error\":\"Missing actionId\"}");
                return true;
            }

            send(context, HttpResponseStatus.OK, resultJson(invokeAction(actionId, project)));
            return true;
        }

        if (path.equals(Prefix + "/hot-reload")) {
            var results = new ArrayList<ActionResult>();
            for (var actionId : DefaultHotReloadActions)
                results.add(invokeAction(actionId, project));
            send(context, HttpResponseStatus.OK, operationJson("hot-reload", project, results));
            return true;
        }

        if (path.equals(Prefix + "/restart-rrd")) {
            var requestedAction = first(query, "actionId");
            var results = new ArrayList<ActionResult>();
            if (requestedAction != null && !requestedAction.isBlank()) {
                results.add(invokeAction(requestedAction, project));
            } else {
                var rerun = invokeAction("Rerun", project);
                results.add(rerun);
                if (!rerun.ok())
                    results.add(debugRunConfiguration(DefaultRestartConfigurationName, project));
            }
            send(context, HttpResponseStatus.OK, operationJson("restart-rrd", project, results));
            return true;
        }

        send(context, HttpResponseStatus.NOT_FOUND, "{\"ok\":false,\"error\":\"Unknown Pe.RiderBridge path\"}");
        return true;
    }

    private static ActionResult invokeAction(String actionId, Project project) {
        var action = ActionManager.getInstance().getAction(actionId);
        if (action == null)
            return new ActionResult(actionId, "missing", false, "Action was not registered in Rider.");

        var result = new AtomicReference<ActionResult>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            try {
                var dataContext = dataContext(project);
                var presentation = action.getTemplatePresentation().clone();
                var event = AnActionEvent.createFromDataContext(ActionPlaces.UNKNOWN, presentation, dataContext);
                action.update(event);
                if (!event.getPresentation().isEnabled()) {
                    result.set(new ActionResult(actionId, "disabled", false, "Action is registered but disabled for the current Rider context."));
                    return;
                }

                ActionUtil.invokeAction(action, dataContext, ActionPlaces.UNKNOWN, null, null);
                result.set(new ActionResult(actionId, "invoked", true, null));
            } catch (Throwable ex) {
                result.set(new ActionResult(actionId, "failed", false, ex.getClass().getSimpleName() + ": " + ex.getMessage()));
            }
        });

        return result.get();
    }

    private static ActionResult debugRunConfiguration(String configurationName, Project project) {
        var result = new AtomicReference<ActionResult>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            try {
                var runManager = RunManager.getInstance(project);
                var settings = runManager.findConfigurationByName(configurationName);
                if (settings == null) {
                    result.set(new ActionResult(
                        "DebugRunConfiguration",
                        "missing",
                        false,
                        "Run configuration '" + configurationName + "' was not found."
                    ));
                    return;
                }

                settings.getConfiguration().checkConfiguration();
                runManager.setSelectedConfiguration(settings);
                var executor = DefaultDebugExecutor.getDebugExecutorInstance();
                ProgramRunnerUtil.executeConfiguration(settings, executor);
                result.set(new ActionResult(
                    "DebugRunConfiguration",
                    "invoked",
                    true,
                    "Debug invoked for run configuration '" + configurationName + "'."
                ));
            } catch (RuntimeConfigurationException ex) {
                result.set(new ActionResult(
                    "DebugRunConfiguration",
                    "invalid-configuration",
                    false,
                    ex.getClass().getSimpleName() + ": " + ex.getMessage()
                ));
            } catch (Throwable ex) {
                result.set(new ActionResult(
                    "DebugRunConfiguration",
                    "failed",
                    false,
                    ex.getClass().getSimpleName() + ": " + ex.getMessage()
                ));
            }
        });

        return result.get();
    }

    private static ActionResult inspectAction(String actionId, Project project) {
        var action = ActionManager.getInstance().getAction(actionId);
        if (action == null)
            return new ActionResult(actionId, "missing", false, "Action was not registered in Rider.");

        var result = new AtomicReference<ActionResult>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            try {
                var dataContext = dataContext(project);
                var presentation = action.getTemplatePresentation().clone();
                var event = AnActionEvent.createFromDataContext(ActionPlaces.UNKNOWN, presentation, dataContext);
                action.update(event);
                var enabled = event.getPresentation().isEnabled();
                result.set(new ActionResult(actionId, enabled ? "enabled" : "disabled", enabled, null));
            } catch (Throwable ex) {
                result.set(new ActionResult(actionId, "failed", false, ex.getClass().getSimpleName() + ": " + ex.getMessage()));
            }
        });

        return result.get();
    }

    private static DataContext dataContext(Project project) {
        return dataId -> CommonDataKeys.PROJECT.is(dataId) ? project : null;
    }

    private static Project selectProject(String requestedProject) {
        var openProjects = ProjectManager.getInstance().getOpenProjects();
        if (openProjects.length == 0)
            return null;

        if (requestedProject == null || requestedProject.isBlank()) {
            for (var project : openProjects) {
                if (matches(project, "Pe.Tools"))
                    return project;
            }
            return openProjects[0];
        }

        for (var project : openProjects) {
            if (matches(project, requestedProject))
                return project;
        }
        return null;
    }

    private static boolean matches(Project project, String value) {
        var needle = value.toLowerCase(Locale.ROOT);
        var name = project.getName();
        if (name != null && name.toLowerCase(Locale.ROOT).contains(needle))
            return true;

        var basePath = project.getBasePath();
        return basePath != null && basePath.toLowerCase(Locale.ROOT).contains(needle);
    }

    private static boolean isLocalHost(FullHttpRequest request) {
        var host = request.headers().get(HttpHeaderNames.HOST);
        if (host == null)
            return true;

        var normalized = host.toLowerCase(Locale.ROOT);
        return normalized.startsWith("127.0.0.1") || normalized.startsWith("localhost") || normalized.startsWith("[::1]");
    }

    private static String first(Map<String, List<String>> query, String name) {
        var values = query.get(name);
        return values == null || values.isEmpty() ? null : values.get(0);
    }

    private static void send(ChannelHandlerContext context, HttpResponseStatus status, String json) {
        var content = Unpooled.copiedBuffer(json, StandardCharsets.UTF_8);
        FullHttpResponse response = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, status, content);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json; charset=utf-8");
        response.headers().set(HttpHeaderNames.CONTENT_LENGTH, content.readableBytes());
        response.headers().set(HttpHeaderNames.CONNECTION, HttpHeaderValues.CLOSE);
        context.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
    }

    private static String operationJson(String operation, Project project, List<ActionResult> results) {
        var ok = results.stream().anyMatch(ActionResult::ok) && results.stream().noneMatch(result -> result.status().equals("failed"));
        var builder = new StringBuilder();
        builder.append("{\"ok\":").append(ok);
        builder.append(",\"operation\":\"").append(json(operation)).append("\"");
        builder.append(",\"project\":\"").append(json(project.getName())).append("\"");
        builder.append(",\"projectBasePath\":\"").append(json(project.getBasePath())).append("\"");
        builder.append(",\"debugSession\":").append(debugSessionJson(project));
        builder.append(",\"results\":[");
        for (var i = 0; i < results.size(); i++) {
            if (i > 0)
                builder.append(',');
            builder.append(resultJson(results.get(i)));
        }
        builder.append(']');
        builder.append(",\"problems\":").append(problemsJson(results));
        builder.append(",\"restartRecommended\":").append(restartRecommended(results));
        builder.append("}");
        return builder.toString();
    }

    private static boolean restartRecommended(List<ActionResult> results) {
        return results.stream().anyMatch(result ->
            !result.ok() && (result.actionId().equals("RiderDebuggerApplyEncChagnes") || result.status().equals("disabled"))
        );
    }

    private static String debugSessionJson(Project project) {
        var builder = new StringBuilder();
        builder.append("{\"actions\":{");
        for (var i = 0; i < DiagnosticActionIds.length; i++) {
            if (i > 0)
                builder.append(',');
            var state = inspectAction(DiagnosticActionIds[i], project);
            builder.append("\"").append(json(state.actionId())).append("\":").append(resultJson(state));
        }
        builder.append("}}");
        return builder.toString();
    }

    private static String problemsJson(List<ActionResult> results) {
        var builder = new StringBuilder();
        builder.append('[');
        var count = 0;
        for (var result : results) {
            if (result.ok())
                continue;
            if (count > 0)
                builder.append(',');
            builder.append("{\"severity\":\"error\"");
            builder.append(",\"source\":\"rider-action\"");
            builder.append(",\"actionId\":\"").append(json(result.actionId())).append("\"");
            builder.append(",\"message\":\"").append(json(result.message() == null ? result.status() : result.message())).append("\"");
            builder.append('}');
            count++;
        }
        builder.append(']');
        return builder.toString();
    }

    private static String resultJson(ActionResult result) {
        var builder = new StringBuilder();
        builder.append("{\"actionId\":\"").append(json(result.actionId())).append("\"");
        builder.append(",\"status\":\"").append(json(result.status())).append("\"");
        builder.append(",\"ok\":").append(result.ok());
        if (result.message() != null)
            builder.append(",\"message\":\"").append(json(result.message())).append("\"");
        builder.append('}');
        return builder.toString();
    }

    private static String json(String value) {
        if (value == null)
            return "";

        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n");
    }

    private record ActionResult(String actionId, String status, boolean ok, String message) {
    }
}
