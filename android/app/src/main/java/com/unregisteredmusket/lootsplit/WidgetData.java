package com.unregisteredmusket.lootsplit;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.DateFormat;
import java.text.NumberFormat;
import java.util.Date;

/** Strict projection of the owner API; absent readings never become healthy/zero. */
final class WidgetData {
    static String text(JSONObject object, String key) {
        Object value = object == null ? null : object.opt(key);
        return value instanceof String ? ((String) value).replaceAll("[\\p{Cntrl}]", " ").trim() : "";
    }
    static String count(JSONObject object, String key) {
        Object value = object == null ? null : object.opt(key);
        if (!(value instanceof Number)) return "—";
        double n = ((Number) value).doubleValue();
        return Double.isFinite(n) && n >= 0 && n <= 9007199254740991d && n == Math.floor(n)
            ? NumberFormat.getIntegerInstance().format(n) : "—";
    }
    static JSONObject ready(JSONObject root, String key) {
        JSONObject source = root.optJSONObject(key);
        return source != null && "ready".equals(text(source, "state")) ? source.optJSONObject("data") : null;
    }
    static String unavailable(JSONObject root, String key) {
        JSONObject source = root.optJSONObject(key);
        return source != null && "not-connected".equals(text(source, "state")) ? "Not connected" : "Unavailable";
    }
    static String time(long timestamp) {
        return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(timestamp));
    }
    static String sourceTime(JSONObject root, String key) {
        JSONObject source = root.optJSONObject(key);
        long at = source == null ? 0 : source.optLong("checkedAt", 0);
        return at > 0 ? " · " + time(at) : "";
    }
    static JSONObject project(JSONObject root, long now) throws Exception {
        JSONObject account = root.getJSONObject("account");
        String name = text(account, "name"), email = text(account, "email");
        long checked = root.getLong("checkedAt");
        if (name.isEmpty() || email.isEmpty() || checked <= 0 || checked > now + 60000 || checked < now - 600000)
            throw new Exception("Invalid owner snapshot");
        JSONObject health = root.getJSONObject("health"), stats = health.optJSONObject("stats");
        boolean healthy = "healthy".equals(text(health, "status"));
        JSONObject traffic = ready(root, "traffic"), development = ready(root, "development");
        JSONObject analytics = ready(root, "analytics"), release = ready(root, "release");
        String trafficText = traffic == null ? unavailable(root, "traffic")
            : count(traffic, "requests") + " requests / " + count(traffic, "errors") + " errors";
        String activity = unavailable(root, "development"), deployment = activity;
        if (development != null) {
            JSONArray active = development.optJSONArray("active"), pulls = development.optJSONArray("openPulls");
            activity = active == null || pulls == null ? "Unavailable"
                : active.length() + " running · " + pulls.length() + " open PRs";
            JSONObject latest = development.optJSONObject("latestDeployment");
            deployment = latest == null ? "No recent deployment" : text(latest, "status").equals("completed")
                ? "Latest: " + text(latest, "conclusion") : "Latest: " + text(latest, "status");
            if (active != null) for (int i = 0; i < active.length(); i++) {
                JSONObject run = active.optJSONObject(i);
                if (run != null && run.optBoolean("deployment", false)) {
                    deployment = "Deploy: " + text(run, "status"); break;
                }
            }
        }
        String games = unavailable(root, "analytics");
        if (analytics != null && analytics.optInt("version") == 1 && "current-shared-campaigns".equals(text(analytics, "scope"))) {
            JSONObject metrics = analytics.optJSONObject("metrics");
            games = count(metrics, "sessions") + " sessions · " + count(metrics, "transactionCount") + " transactions";
        }
        String commit = release == null ? "Unavailable" : text(release, "commit");
        if (release != null) commit = commit.matches("[a-f0-9]{40}") ? commit.substring(0, 7) : "Unavailable";
        JSONObject projected = new JSONObject().put("name", name).put("email", email).put("checkedAt", checked)
            .put("healthy", healthy).put("health", healthy ? "SYSTEMS HEALTHY" : "CHECK SERVICES")
            .put("active", count(stats, "active5m")).put("accounts", count(stats, "accounts"))
            .put("campaigns", count(stats, "sharedCampaigns")).put("backups", count(stats, "cloudBackups"))
            .put("traffic", trafficText).put("trafficTime", sourceTime(root, "traffic"))
            .put("development", activity).put("deployment", deployment)
            .put("developmentTime", sourceTime(root, "development"))
            .put("games", games).put("gamesTime", sourceTime(root, "analytics"))
            .put("commit", commit);
        JSONArray checks = health.optJSONArray("checks");
        StringBuilder service = new StringBuilder();
        if (checks != null) for (int i = 0; i < checks.length(); i++) {
            JSONObject check = checks.getJSONObject(i);
            if (i > 0) service.append(" · ");
            service.append(text(check, "name")).append(": ").append(text(check, "status"));
        }
        return projected.put("services", service.length() == 0 ? "Service checks unavailable" : service.toString());
    }
}
