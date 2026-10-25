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
    /** The plan-usage gauges (billing cycle to date): flows only; storage is a level and stays a text row. */
    static final java.util.Map<String, String> GAUGES = new java.util.LinkedHashMap<>();
    static { GAUGES.put("requests", "Req"); GAUGES.put("cpuMs", "CPU"); GAUGES.put("d1RowsRead", "D1 rd"); GAUGES.put("d1RowsWritten", "D1 wr"); }
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
        // Servers since 2026-10-22 send the billing cycle ("Cycle since Oct 11"); older ones the calendar month.
        String cycleLabel = month == null ? "" : text(month, "label");
        boolean billingCycle = month != null && "billing-cycle".equals(text(month, "basis")) && cycleLabel.matches("[A-Za-z0-9 ]{1,32}");
        String windowName = billingCycle ? cycleLabel : "Month";
        JSONArray gauges = new JSONArray();
        Object elapsedPercent = month == null ? null : month.opt("elapsedPercent");
        out.put("elapsed", elapsedPercent instanceof Number ? ((Number) elapsedPercent).doubleValue() : -1d).put("cycleLabel", billingCycle ? cycleLabel : "");
        out.put("gauges", gauges);
        for (int i = 0; i < metrics.length() && rows.length() < USAGE_ROWS; i++) {
            JSONObject metric = metrics.optJSONObject(i);
            if (metric == null) continue;
            String label = text(metric, "label"), unit = text(metric, "unit"), level = text(metric, "level");
            if (label.isEmpty() || label.length() > 40) continue;
            if (!"ready".equals(text(metric, "state"))) {
                String code = text(metric, "errorCode");
                rows.put(new JSONObject().put("id", "usage:" + label).put("title", label + " · unavailable").put("color", "")
                    .put("detail", "No reading" + (code.matches("[A-Z0-9_]{1,40}") ? " (" + code + ")" : "") + "; not counted as zero"));
                continue;
            }
            // Billing cycle to date at or above 80% of the allowance (or over it) is amber; never red: overage is billed, not an outage.
            String color = "attention".equals(level) || "over".equals(level) ? "yellow" : "";
            if ("bytes".equals(unit)) {
                Object databases = metric.opt("databases");
                rows.put(new JSONObject().put("id", "usage:" + label).put("color", color)
                    .put("title", label + " " + amount(part(metric, "current", "value"), unit))
                    .put("detail", percent(part(metric, "current", "percent")) + " of " + allowance(metric.opt("allowance"), unit) + " included · current size"
                        + (databases instanceof Number ? " · " + ((Number) databases).longValue() + " database" + (((Number) databases).longValue() == 1 ? "" : "s") : "")));
                continue;
            }
            String key = text(metric, "key"), shortLabel = GAUGES.get(key);
            Object cycle = part(metric, "month", "percent");
            if (shortLabel != null) gauges.put(new JSONObject().put("key", key).put("label", shortLabel)
                .put("percent", cycle instanceof Number && Double.isFinite(((Number) cycle).doubleValue()) && ((Number) cycle).doubleValue() >= 0 ? ((Number) cycle).doubleValue() : JSONObject.NULL)
                .put("text", percent(cycle)).put("hot", !color.isEmpty()));
            rows.put(new JSONObject().put("id", "usage:" + label).put("color", color)
                .put("title", label + " today " + amount(part(metric, "day", "value"), unit))
                .put("detail", percent(part(metric, "day", "percent")) + " of daily share\n7d " + amount(part(metric, "week", "value"), unit)
                    + " (" + percent(part(metric, "week", "percent")) + " of weekly share)\n" + windowName + " " + amount(part(metric, "month", "value"), unit)
                    + " (" + percent(part(metric, "month", "percent")) + " of " + allowance(metric.opt("monthlyAllowance"), unit) + ")"));
        }
        return out.put("state", "ready").put("reason", "").put("rows", rows)
            .put("summary", "Workers Paid allowance · account-wide, UTC · " + elapsed + " of " + (billingCycle ? "billing cycle elapsed · " + Character.toLowerCase(cycleLabel.charAt(0)) + cycleLabel.substring(1) : "month elapsed"));
    }
    /** A plausible past timestamp (not more than a minute in the future), else 0. */
    static long time(JSONObject object, String key, long now) {
        Object value = object == null ? null : object.opt(key);
        if (!(value instanceof Number)) return 0;
        long at = ((Number) value).longValue();
        return at > 0 && at <= now + 60000 ? at : 0;
    }
    /** A whole non-negative count, or JSON null (unmeasured; never 0). */
    static Object whole(Object value) {
        if (!(value instanceof Number)) return JSONObject.NULL;
        double n = ((Number) value).doubleValue();
        return Double.isFinite(n) && n >= 0 && n <= 9007199254740991d && n == Math.floor(n) ? (Object) ((Number) value).longValue() : JSONObject.NULL;
    }
    static final java.util.List<String> SEVERITIES = java.util.Arrays.asList("critical", "warning", "info");
    /**
     * critical (✕ CRIT) for a confirmed failure, info (i INFO) for a coverage limit or optional
     * check, otherwise warning (! WARN), including a required check that cannot be verified; ""
     * when green. The server's value is used when valid; older servers send none and the same rule
     * is applied here. Plan usage is never a severity (owner decision 6).
     */
    static String severity(JSONObject entry, String server) {
        String color = text(entry, "color");
        if ("green".equals(color)) return "";
        if (SEVERITIES.contains(server)) return server;
        if ("red".equals(color) || entry.optBoolean("confirmedFailure", false)) return "critical";
        if (!entry.optBoolean("required", true) || entry.optBoolean("coverageLimit", false)) return "info";
        return "warning";
    }
    static final int SERIES_POINTS = 48, SERIES_DAYS = 7, RESOLVED_ITEMS = 5, MAIN_RUNS = 20;
    /** "absent" (older server: needs an update), "unavailable" (read failed) or the server's state. */
    private static JSONObject part(JSONObject root, String key) throws Exception {
        JSONObject source = root.optJSONObject(key);
        if (source == null) return new JSONObject().put("state", "absent");
        if (!"ready".equals(text(source, "state"))) {
            String code = text(source, "errorCode");
            return new JSONObject().put("state", "unavailable").put("errorCode", code.matches("[A-Z0-9_]{1,40}") ? code : "");
        }
        return null;
    }
    private static JSONArray counts(JSONArray source, int size) {
        if (source == null || source.length() != size) return null;
        JSONArray out = new JSONArray();
        for (int i = 0; i < size; i++) out.put(whole(source.opt(i)));
        return out;
    }
    /** Requests/errors per half-hour (48) and per local day (7); null entries stay gaps. */
    static JSONObject series(JSONObject root) throws Exception {
        JSONObject gap = part(root, "series");
        if (gap != null) return gap;
        JSONObject source = root.getJSONObject("series"), half = source.optJSONObject("halfHour");
        JSONArray requests = half == null ? null : counts(half.optJSONArray("requests"), SERIES_POINTS);
        JSONArray errors = half == null ? null : counts(half.optJSONArray("errors"), SERIES_POINTS);
        JSONArray days = source.optJSONArray("daily"), daily = new JSONArray();
        if (requests == null || errors == null || days == null) return new JSONObject().put("state", "unavailable").put("errorCode", "INVALID_SERIES");
        for (int i = 0; i < days.length() && daily.length() < SERIES_DAYS; i++) {
            JSONObject day = days.optJSONObject(i);
            String date = text(day, "day");
            if (day == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) continue;
            daily.put(new JSONObject().put("day", date).put("requests", whole(day.opt("requests"))).put("errors", whole(day.opt("errors")))
                .put("measured", Math.max(0, day.optInt("measured", 0))).put("expected", Math.max(0, day.optInt("expected", 0)))
                .put("active", whole(day.opt("active24hMax"))));
        }
        return new JSONObject().put("state", "ready").put("end", half.optLong("end", 0)).put("intervalMs", half.optLong("intervalMs", 1800000))
            .put("requests", requests).put("errors", errors).put("measured", Math.max(0, half.optInt("measured", 0))).put("daily", daily);
    }
    private static String clip(String value, int size) { return value.length() > size ? value.substring(0, size - 1) + "…" : value; }
    /** Problems resolved in the last 24 hours (at most five, newest first), with their start and end. */
    static JSONObject resolved(JSONObject root, long now) throws Exception {
        JSONObject gap = part(root, "recentlyResolved");
        if (gap != null) return gap;
        JSONObject source = root.getJSONObject("recentlyResolved");
        JSONArray items = source.optJSONArray("items"), out = new JSONArray();
        if (items != null) for (int i = 0; i < items.length() && out.length() < RESOLVED_ITEMS; i++) {
            JSONObject item = items.optJSONObject(i);
            String component = text(item, "component");
            long start = time(item, "startedAt", now), end = time(item, "resolvedAt", now);
            if (item == null || component.isEmpty() || end <= 0) continue;
            String severity = text(item, "severity");
            JSONArray history = item.optJSONArray("history"), safeHistory = new JSONArray();
            if (history != null) for (int h = 0; h < Math.min(3, history.length()); h++) {
                JSONObject entry = history.optJSONObject(h);
                if (entry != null) safeHistory.put(new JSONObject().put("at", time(entry, "at", now)).put("color", text(entry, "color")).put("symptom", clip(text(entry, "symptom"), 200)));
            }
            out.put(new JSONObject().put("component", clip(component, 80)).put("severity", SEVERITIES.contains(severity) ? severity : "warning")
                .put("startedAt", start).put("resolvedAt", end).put("durationMs", start > 0 ? Math.max(0, end - start) : 0)
                .put("resolution", "retired".equals(text(item, "resolution")) ? "retired" : "resolved")
                .put("brief", clip(text(item, "brief"), 80)).put("symptom", clip(text(item, "symptom"), 240)).put("impact", clip(text(item, "impact"), 200)).put("history", safeHistory));
        }
        int total = Math.max(out.length(), source.optInt("total", out.length()));
        return new JSONObject().put("state", "ready").put("items", out).put("total", total).put("complete", source.optBoolean("complete", true));
    }
    /** Live rooms (activity in the last 5 minutes) or an explicit gap. */
    static JSONObject rooms(JSONObject root, long now) throws Exception {
        JSONObject gap = part(root, "rooms");
        if (gap != null) return gap;
        JSONObject source = root.getJSONObject("rooms");
        Object live = whole(source.opt("live"));
        if (live == JSONObject.NULL) return new JSONObject().put("state", "unavailable").put("errorCode", "INVALID_COUNT");
        return new JSONObject().put("state", "ready").put("live", live).put("checkedAt", time(source, "checkedAt", now));
    }
    /** The last completed runs on main for the CI pips; null for an older server or no GitHub reading. */
    static JSONArray mainRuns(JSONObject root, long now) throws Exception {
        JSONObject development = ready(root, "development");
        JSONArray runs = development == null ? null : development.optJSONArray("mainRuns");
        if (runs == null) return null;
        JSONArray out = new JSONArray();
        for (int i = 0; i < runs.length() && out.length() < MAIN_RUNS; i++) {
            JSONObject run = runs.optJSONObject(i);
            if (run == null) continue;
            out.put(new JSONObject().put("name", clip(text(run, "name"), 40)).put("conclusion", text(run, "conclusion")).put("at", time(run, "at", now)).put("deployment", run.optBoolean("deployment", false)));
        }
        return out;
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
            // Redesign (2026-10-25): severity, start and duration, which the face once dropped.
            entry.put("confirmedFailure",source.optBoolean("confirmedFailure",false)).put("retainedFailure",source.optBoolean("retainedFailure",false));
            entry.put("firstOccurredAt",time(source,"firstOccurredAt",now)).put("durationMs",Math.max(0,source.optLong("durationMs",0)));
            Object errorCount=source.opt("errorCount"),requestCount=source.opt("requestCount");
            entry.put("errorCount",whole(errorCount)).put("requestCount",whole(requestCount));
            entry.put("severity",severity(entry,text(source,"severity")));
            if("Worker execution errors".equals(text(source,"component")))projected.put("errorsColor",text(source,"color")).put("errorsState",text(source,"state"));
            safe.put(entry);
        }
        projected.put("diagnostics",safe);
        projected.put("series",series(root)).put("resolved",resolved(root,now)).put("rooms",rooms(root,now));
        JSONArray runs=mainRuns(root,now);
        if(runs!=null)projected.put("mainRuns",runs);
        projected.put("activeAccounts24h",count(stats,"active24h"));
        if(development!=null){JSONObject latest=development.optJSONObject("latestDeployment");long at=latest==null?0:time(latest,"updatedAt",now);projected.put("deployedAt",at);}
        JSONObject developmentSource=root.optJSONObject("development"),trafficSource=root.optJSONObject("traffic");
        projected.put("reused",(developmentSource!=null&&developmentSource.optBoolean("reused",false)?"GitHub "+WidgetRows.clock(developmentSource.optLong("checkedAt")):"")
            +(trafficSource!=null&&trafficSource.optBoolean("reused",false)?(developmentSource!=null&&developmentSource.optBoolean("reused",false)?" · ":"")+"Cloudflare "+WidgetRows.clock(trafficSource.optLong("checkedAt")):""));
        if(report!=null){JSONArray gaps=report.optJSONArray("gaps");projected.put("reportDay",text(report,"day")).put("reportGaps",gaps==null?-1:gaps.length());}
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
