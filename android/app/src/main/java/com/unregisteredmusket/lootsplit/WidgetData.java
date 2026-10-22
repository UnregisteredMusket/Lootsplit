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
    static final int ACTIVITY_EVENTS = 6;
    /** Short, honest reason for an unavailable GitHub reading; never phrased as "no activity". */
    static String activityReason(JSONObject source) {
        if (source == null) return "GitHub activity unavailable · no reading";
        if ("not-connected".equals(text(source, "state"))) return "GitHub activity not connected";
        String code = text(source, "errorCode");
        String reason = code.endsWith("_RATE_LIMITED") ? "rate limited"
            : code.equals("HTTP_401") || code.equals("HTTP_403") ? "access denied"
            : code.matches("HTTP_[1-5][0-9][0-9]") ? "GitHub error " + code.substring(5)
            : code.equals("SOURCE_TIMEOUT") ? "timed out" : "no response";
        return "GitHub activity unavailable · " + reason;
    }
    /**
     * GitHub workflow and pull request events for the Agent activity companion. A source that is
     * unavailable, disconnected or from a server without events stays an explicit unavailable state.
     */
    static JSONObject activity(JSONObject root, long now) throws Exception {
        JSONObject source = root.optJSONObject("development"), out = new JSONObject();
        JSONObject data = ready(root, "development");
        JSONArray events = data == null ? null : data.optJSONArray("events");
        long checked = source == null ? 0 : source.optLong("checkedAt", 0);
        out.put("checkedAt", checked > 0 && checked <= now + 60000 ? checked : 0);
        if (data == null || events == null) {
            out.put("state", source != null && "not-connected".equals(text(source, "state")) ? "not-connected" : "unavailable");
            out.put("reason", data != null ? "GitHub activity unavailable · not provided by server" : activityReason(source));
            return out.put("active", 0).put("events", new JSONArray());
        }
        JSONArray safe = new JSONArray();
        for (int i = 0; i < events.length() && safe.length() < ACTIVITY_EVENTS; i++) {
            JSONObject event = events.optJSONObject(i);
            if (event == null) continue;
            String text = text(event, "text"), state = text(event, "state");
            long at = event.optLong("at", 0);
            if (text.isEmpty() || at <= 0) continue;
            if (text.length() > 120) text = text.substring(0, 119) + "…";
            String title = text(event, "title");
            if (title.length() > 80) title = title.substring(0, 79) + "…";
            Object pr = event.opt("pr");
            safe.put(new JSONObject().put("kind", text(event, "kind")).put("text", text).put("title", title)
                .put("state", java.util.Arrays.asList("ok", "active", "attention", "fail").contains(state) ? state : "attention")
                .put("pr", pr instanceof Number && ((Number) pr).longValue() > 0 ? ((Number) pr).longValue() : 0)
                .put("at", at));
        }
        int active = data.optInt("activeActivity", 0);
        return out.put("state", "ready").put("reason", "").put("active", Math.max(0, active)).put("events", safe);
    }
    static final int USAGE_ROWS = 6;
    /** "—" when missing, "<0.01%" for tiny shares; the same rules as the server and website. */
    static String percent(Object value) {
        if (!(value instanceof Number)) return "—";
        double p = ((Number) value).doubleValue();
        if (!Double.isFinite(p) || p < 0) return "—";
        if (p == 0) return "0%";
        if (p < 0.01) return "<0.01%";
        return (p < 1 ? String.format(java.util.Locale.ROOT, "%.2f", p) : p < 10 ? String.format(java.util.Locale.ROOT, "%.1f", p) : Long.toString(Math.round(p))) + "%";
    }
    static String amount(Object value, String unit) {
        if (!(value instanceof Number)) return "—";
        double n = ((Number) value).doubleValue();
        if (!Double.isFinite(n) || n < 0 || n > 9007199254740991d) return "—";
        if ("bytes".equals(unit)) return n >= 1e9 && n % 1e9 == 0 ? Math.round(n / 1e9) + " GB" : n >= 1e9 ? String.format(java.util.Locale.ROOT, "%.2f GB", n / 1e9) : n >= 1e6 ? String.format(java.util.Locale.ROOT, "%.1f MB", n / 1e6) : NumberFormat.getIntegerInstance().format(Math.round(n / 1e3)) + " kB";
        String text = NumberFormat.getIntegerInstance().format(Math.round(n));
        return "ms".equals(unit) ? text + " ms" : text;
    }
    static String allowance(Object value, String unit) {
        if (!(value instanceof Number)) return "—";
        long n = ((Number) value).longValue();
        return "bytes".equals(unit) ? amount(value, unit) : WidgetRows.compact(n) + ("ms".equals(unit) ? " ms" : "");
    }
    private static Object part(JSONObject metric, String window, String key) {
        JSONObject part = metric.optJSONObject(window);
        return part == null || part.isNull(key) ? null : part.opt(key);
    }
    /**
     * Cloudflare plan usage (hourly, account-wide, UTC) against the Workers Paid allowance:
     * one row per metric with precomputed text. A missing, stale, disconnected or older-server
     * reading stays an explicit unavailable state; a missing metric is never shown as zero.
     */
    static JSONObject usage(JSONObject root, long now) throws Exception {
        JSONObject source = root.optJSONObject("usage"), out = new JSONObject();
        long checked = source == null ? 0 : source.optLong("checkedAt", 0);
        out.put("checkedAt", checked > 0 && checked <= now + 60000 ? checked : 0);
        JSONObject data = source != null && "ready".equals(text(source, "state")) ? source.optJSONObject("data") : null;
        JSONArray metrics = data == null ? null : data.optJSONArray("metrics");
        JSONArray rows = new JSONArray();
        if (metrics == null) {
            String state = source == null ? "" : text(source, "state"), code = source == null ? "" : text(source, "errorCode");
            out.put("state", "not-connected".equals(state) ? "not-connected" : "unavailable");
            out.put("reason", source == null ? "Cloudflare usage unavailable · not provided by server"
                : "not-connected".equals(state) ? "Cloudflare usage not connected"
                : "STALE_READING".equals(code) ? "Cloudflare usage unavailable · last hourly reading over 2 hours old"
                : "NOT_COLLECTED".equals(code) ? "Cloudflare usage unavailable · first hourly reading pending"
                : "Cloudflare usage unavailable" + (code.matches("[A-Z0-9_]{1,40}") ? " · " + code : ""));
            return out.put("summary", "").put("rows", rows);
        }
        JSONObject month = data.optJSONObject("windows") == null ? null : data.optJSONObject("windows").optJSONObject("month");
        String elapsed = month == null ? "—" : percent(month.opt("elapsedPercent"));
        for (int i = 0; i < metrics.length() && rows.length() < USAGE_ROWS; i++) {
            JSONObject metric = metrics.optJSONObject(i);
            if (metric == null) continue;
            String label = text(metric, "label"), unit = text(metric, "unit"), level = text(metric, "level");
            if (label.isEmpty() || label.length() > 40) continue;
            if (!"ready".equals(text(metric, "state"))) {
                String code = text(metric, "errorCode");
                rows.put(new JSONObject().put("title", label + " · unavailable").put("color", "")
                    .put("detail", "No reading" + (code.matches("[A-Z0-9_]{1,40}") ? " (" + code + ")" : "") + "; not counted as zero"));
                continue;
            }
            // Month to date at or above 80% of the allowance (or over it) is amber; never red: overage is billed, not an outage.
            String color = "attention".equals(level) || "over".equals(level) ? "yellow" : "";
            if ("bytes".equals(unit)) {
                Object databases = metric.opt("databases");
                rows.put(new JSONObject().put("color", color)
                    .put("title", label + " " + amount(part(metric, "current", "value"), unit))
                    .put("detail", percent(part(metric, "current", "percent")) + " of " + allowance(metric.opt("allowance"), unit) + " included · current size"
                        + (databases instanceof Number ? " · " + ((Number) databases).longValue() + " database" + (((Number) databases).longValue() == 1 ? "" : "s") : "")));
                continue;
            }
            rows.put(new JSONObject().put("color", color)
                .put("title", label + " today " + amount(part(metric, "day", "value"), unit))
                .put("detail", percent(part(metric, "day", "percent")) + " of daily share\n7d " + amount(part(metric, "week", "value"), unit)
                    + " (" + percent(part(metric, "week", "percent")) + " of weekly share)\nMonth " + amount(part(metric, "month", "value"), unit)
                    + " (" + percent(part(metric, "month", "percent")) + " of " + allowance(metric.opt("monthlyAllowance"), unit) + ")"));
        }
        return out.put("state", "ready").put("reason", "").put("rows", rows)
            .put("summary", "Workers Paid allowance · account-wide, UTC · " + elapsed + " of month elapsed");
    }
    /** healthy, attention (a recent problem, not current), unverified or failure; older servers send only a colour. */
    static String statusKind(JSONObject overall) {
        if (overall == null) return "unverified";
        String status = text(overall, "status"), color = text(overall, "color");
        if (java.util.Arrays.asList("healthy", "attention", "unverified", "failure").contains(status)
                && ("failure".equals(status) == "red".equals(color)) && ("healthy".equals(status) == "green".equals(color))) return status;
        return "green".equals(color) ? "healthy" : "red".equals(color) ? "failure" : "unverified";
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
            .put("healthy", healthy).put("health", "STATUS UNVERIFIED")
            .put("active", count(stats, "active5m")).put("accounts", count(stats, "accounts"))
            .put("campaigns", count(stats, "sharedCampaigns")).put("backups", count(stats, "cloudBackups"))
            .put("traffic", trafficText).put("trafficTime", sourceTime(root, "traffic"))
            .put("development", activity).put("deployment", deployment)
            .put("developmentTime", sourceTime(root, "development"))
            .put("games", games).put("gamesTime", sourceTime(root, "analytics"))
            .put("commit", commit);
        projected.put("activity", activity(root, now));
        projected.put("usage", usage(root, now));
        projected.put("snapshotId", root.optLong("snapshotId",0));
        JSONObject overall=root.optJSONObject("overall");
        projected.put("statusColor",overall==null?"yellow":text(overall,"color"));
        projected.put("overallReason",overall==null?"Component coverage unavailable":text(overall,"reason"));
        String kind=statusKind(overall);
        projected.put("statusKind",kind);
        if(overall!=null)projected.put("health","healthy".equals(kind)?"HEALTHY AT LAST CHECK":"failure".equals(kind)?"CONFIRMED ERROR":"attention".equals(kind)?"NEEDS ATTENTION":"STATUS UNVERIFIED");
        // Coverage limits (by-design gaps) are named for information; they never decide the status.
        JSONArray notes=overall==null?null:overall.optJSONArray("notes"),safeNotes=new JSONArray();
        if(notes!=null)for(int i=0;i<Math.min(5,notes.length());i++){String note=notes.optString(i,"").replaceAll("[\\p{Cntrl}]"," ").trim();if(!note.isEmpty())safeNotes.put(note.length()>80?note.substring(0,79)+"…":note);}
        projected.put("overallNotes",safeNotes);
        JSONObject monitoring=root.optJSONObject("monitoring"),report=root.optJSONObject("dailyReport"),status=root.optJSONObject("developmentStatus");
        projected.put("log",monitoring==null?"No scheduled monitoring entry yet":text(monitoring,"summary"));
        JSONArray recent=root.optJSONArray("recentEntries"),safeRecent=new JSONArray();
        if(recent!=null)for(int i=0;i<Math.min(3,recent.length());i++){JSONObject entry=recent.optJSONObject(i);if(entry!=null)safeRecent.put(new JSONObject().put("summary",text(entry,"summary")).put("observedAt",entry.optLong("observedAt")));}
        projected.put("recentEntries",safeRecent);
        projected.put("report",report==null?"No daily report yet":text(report,"summary"));
        if(status!=null) {
            JSONObject sourceTask=status.optJSONObject("task"),warning=status.optJSONObject("warning");
            projected.put("warning",warning==null?"":text(warning,"message")+" "+text(warning,"nextAction"));
            if(sourceTask!=null) {
                JSONObject task=new JSONObject();
                for(String field:new String[]{"id","title","objective","phase","progress","state","blocker","nextAction"})task.put(field,text(sourceTask,field));
                for(String field:new String[]{"revision","startedAt","heartbeatAt","progressAt","completedAt","totalElapsedMs","unobservedMs"})task.put(field,sourceTask.optLong(field,0));
                task.put("active",sourceTask.optBoolean("active",false));projected.put("task",task);
            }
        }
        JSONArray diagnostics=root.optJSONArray("diagnostics"),safe=new JSONArray();
        if(diagnostics!=null)for(int i=0;i<Math.min(30,diagnostics.length());i++) {
            JSONObject source=diagnostics.optJSONObject(i);if(source==null)continue;JSONObject entry=new JSONObject();
            for(String field:new String[]{"component","color","state","symptom","impact","action","errorCode","brief"})entry.put(field,text(source,field));
            long lastAt=source.optLong("lastAt",0);
            entry.put("lastAt",lastAt>0&&lastAt<=now+60000?lastAt:0);
            entry.put("required",source.optBoolean("required",true)).put("coverageLimit",source.optBoolean("coverageLimit",false));
            if("Worker execution errors".equals(text(source,"component")))projected.put("errorsColor",text(source,"color")).put("errorsState",text(source,"state"));
            safe.put(entry);
        }
        projected.put("diagnostics",safe);
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
