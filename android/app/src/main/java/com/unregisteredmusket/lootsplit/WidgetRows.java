package com.unregisteredmusket.lootsplit;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.DateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class WidgetRows {
    static void add(JSONArray rows, String title, String detail, String action) throws Exception {
        add(rows,title,detail,action,"");
    }
    static void add(JSONArray rows, String title, String detail, String action, String color) throws Exception {
        add(rows,title,detail,action,color,"");
    }
    static void add(JSONArray rows, String title, String detail, String action, String color, String time) throws Exception {
        rows.put(new JSONObject().put("title", title).put("detail", detail).put("action", action).put("color",color).put("time",time));
    }
    static JSONArray rows(JSONObject snapshot) { return rows(snapshot, java.util.Collections.<String>emptySet()); }
    /**
     * The Field monitor list (redesign approved 2026-10-25), top to bottom: Needs attention (active
     * items, critical → warning → info), Recently resolved (24 h), At a glance tiles (an expanded tile
     * takes a full row, so {@code expanded} decides the packing), the report/agent strip, and More:
     * every row the widget listed before, in its earlier order. Each row has a {@code kind}
     * (section, item, resolved, note, tiles, strip, row) and a stable ID.
     */
    static JSONArray rows(JSONObject snapshot, java.util.Set<String> expanded) {
        JSONArray rows = new JSONArray();
        try {
            if (snapshot == null) { add(rows, "No current owner reading", "Sign in or tap Refresh. Backend logging continues independently.", "account"); return identify(rows); }
            java.util.List<JSONObject> items = attentionItems(snapshot);
            int active = 0; for (JSONObject item : items) if (!"info".equals(item.optString("severity"))) active++;
            section(rows, "attention", active > 0 ? "Needs attention" : "Attention", active > 0 ? active + " active" : "none active");
            if (items.isEmpty()) note(rows, "attention:none", "✓", "green", "No active problems", "All checks passed in this reading", "diagnostics");
            for (JSONObject item : items) rows.put(item);
            resolvedRows(rows, snapshot);
            section(rows, "glance", "At a glance", "");
            WidgetTiles.add(rows, snapshot, expanded == null ? java.util.Collections.<String>emptySet() : expanded);
            rows.put(WidgetTiles.strip(snapshot));
            section(rows, "more", "More", "");
            more(rows, snapshot);
        } catch (Exception ignored) { }
        return identify(rows);
    }
    private static void section(JSONArray rows, String id, String title, String detail) throws Exception {
        rows.put(new JSONObject().put("kind", "section").put("id", "section:" + id).put("title", title).put("detail", detail));
    }
    /** A one-line note (no expansion): glyph, text and, when tapped, an app destination. */
    static void note(JSONArray rows, String id, String glyph, String color, String title, String line, String action) throws Exception {
        rows.put(new JSONObject().put("kind", "note").put("id", id).put("glyph", glyph).put("color", color).put("title", title).put("line", line).put("action", action == null ? "" : action));
    }
    static int rank(String severity) { return "critical".equals(severity) ? 0 : "warning".equals(severity) ? 1 : "info".equals(severity) ? 2 : 3; }
    static String chip(String severity) { return "critical".equals(severity) ? "✕ CRIT" : "warning".equals(severity) ? "! WARN" : "i INFO"; }
    static String severityWord(String severity) { return "critical".equals(severity) ? "Critical" : "warning".equals(severity) ? "Warning" : "info".equals(severity) ? "Info" : "Resolved"; }
    /** 45s → "<1m", "31m", "2h 5m", "3d 4h". */
    static String duration(long ms) {
        long minutes = Math.max(0, ms) / 60000;
        if (minutes < 1) return "<1m";
        if (minutes < 60) return minutes + "m";
        if (minutes < 1440) return (minutes / 60) + "h" + (minutes % 60 == 0 ? "" : " " + (minutes % 60) + "m");
        return (minutes / 1440) + "d" + ((minutes % 1440) / 60 == 0 ? "" : " " + ((minutes % 1440) / 60) + "h");
    }
    private static String firstSentence(String text, int size) {
        int end = text.indexOf(". ");
        String out = end > 0 ? text.substring(0, end + 1) : text;
        return out.length() > size ? out.substring(0, size - 1) + "…" : out;
    }
    /** Severity counts [critical, warning, info] of the active items (the status header's ✕ ! i). */
    static int[] counts(JSONObject snapshot) {
        int[] out = new int[3];
        for (JSONObject item : attentionItems(snapshot)) { int r = rank(item.optString("severity")); if (r < 3) out[r]++; }
        return out;
    }
    /**
     * Active attention items: every diagnostic that is not green (with its severity, start and
     * duration) and the development telemetry warning. Plan usage is not an item (owner decision 6).
     * Stable order within a severity.
     */
    static java.util.List<JSONObject> attentionItems(JSONObject snapshot) {
        java.util.List<JSONObject> out = new java.util.ArrayList<>();
        if (snapshot == null) return out;
        long checked = snapshot.optLong("checkedAt");
        try {
            JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
            if (diagnostics != null) for (int i = 0; i < diagnostics.length(); i++) {
                JSONObject check = diagnostics.optJSONObject(i);
                if (check == null) continue;
                String severity = check.has("severity") ? check.optString("severity") : WidgetData.severity(check, "");
                if (severity.isEmpty()) continue;
                out.add(item(snapshot, check, severity, checked));
            }
            String warning = snapshot.optString("warning");
            if (!warning.isEmpty()) {
                JSONArray buttons = new JSONArray().put(new JSONArray().put("TASK").put("task")).put(new JSONArray().put("HISTORY").put("logs")).put(new JSONArray().put("REPORT").put("report"));
                out.add(new JSONObject().put("kind", "item").put("id", "development-warning").put("title", "Development warning").put("color", "yellow").put("severity", "warning")
                    .put("tag", "ACTIVE").put("meta", warning).put("detail", warning).put("action", "task").put("time", "")
                    .put("lines", "Severity  Warning · development telemetry is missing or late\n" + warning).put("next", "").put("buttons", buttons));
            }
        } catch (Exception ignored) { }
        java.util.Collections.sort(out, (a, b) -> rank(a.optString("severity")) - rank(b.optString("severity")));
        return out;
    }
    private static JSONObject item(JSONObject snapshot, JSONObject check, String severity, long checked) throws Exception {
        String component = check.optString("component"), symptom = check.optString("symptom"), action = check.optString("action"), state = check.optString("state");
        long started = check.optLong("firstOccurredAt", 0), lastAt = check.optLong("lastAt", 0);
        boolean info = "info".equals(severity);
        String evidence = !check.optString("brief").isEmpty() ? check.optString("brief") : firstSentence(symptom, 70);
        String meta = evidence + (!info && started > 0 ? " · started " + clock(started) + " · " + duration(checked - started) : "");
        String reason = "critical".equals(severity)
            ? "Critical · confirmed failure" + (check.optBoolean("retainedFailure") ? " (not yet rechecked)" : "")
            : "warning".equals(severity) ? ("warning".equals(state) ? "Warning · a recent problem that has stopped" : "Warning · cannot be verified now (a required check)")
            : "Info · coverage limit; never decides the status";
        StringBuilder lines = new StringBuilder("Severity  ").append(reason);
        if (started > 0) lines.append("\nStarted   ").append(clock(started)).append(" · active ").append(duration(checked - started)).append(" at this reading");
        if (lastAt > 0) lines.append(started > 0 ? " · last " : "\nLast      ").append(clock(lastAt));
        Object errors = check.opt("errorCount"), requests = check.opt("requestCount");
        if (errors instanceof Number && requests instanceof Number && ((Number) requests).longValue() > 0) {
            long e = ((Number) errors).longValue(), r = ((Number) requests).longValue();
            lines.append("\nEvidence  ").append(java.text.NumberFormat.getIntegerInstance().format(e)).append(" of ").append(java.text.NumberFormat.getIntegerInstance().format(r))
                .append(" requests (").append(String.format(Locale.ROOT, e * 1000 / r < 1 ? "%.3f" : "%.1f", e * 100d / r)).append("%) in 24h");
        } else if (!check.optString("brief").isEmpty()) lines.append("\nEvidence  ").append(check.optString("brief"));
        if (!symptom.isEmpty()) lines.append("\nSymptom   ").append(symptom);
        if (!check.optString("impact").isEmpty()) lines.append("\nImpact    ").append(check.optString("impact"));
        JSONArray buttons = new JSONArray().put(new JSONArray().put("DIAGNOSTICS").put("diagnostics")).put(new JSONArray().put("HISTORY").put("logs")).put(new JSONArray().put("REPORT").put("report"));
        JSONObject out = new JSONObject().put("kind", "item").put("id", "diagnostic:" + component).put("title", component).put("color", check.optString("color", "yellow"))
            .put("severity", severity).put("tag", info ? "NOTE" : "ACTIVE").put("meta", meta).put("detail", symptom + "\n" + action).put("action", "diagnostics")
            .put("time", clock(lastAt)).put("startedAt", started).put("lines", lines.toString()).put("next", action.isEmpty() ? "" : "Action: " + action).put("buttons", buttons);
        // The Worker errors item expands into errors per half-hour for the last 6 hours (12 slots).
        JSONObject series = snapshot.optJSONObject("series");
        if ("Worker execution errors".equals(component) && series != null && "ready".equals(series.optString("state"))) {
            JSONArray all = series.optJSONArray("errors"), recent = new JSONArray();
            if (all != null) for (int i = Math.max(0, all.length() - 12); i < all.length(); i++) recent.put(all.opt(i));
            out.put("chart", recent);
        }
        return out;
    }
    /** Recently resolved (24 h): one line per recovery, or an explicit note (older server, unavailable, none). */
    private static void resolvedRows(JSONArray rows, JSONObject snapshot) throws Exception {
        section(rows, "resolved", "Recently resolved", "24h");
        JSONObject resolved = snapshot.optJSONObject("resolved");
        // No object at all: a reading stored by the previous app version (the next refresh fills it).
        if (resolved == null) { note(rows, "resolved:refresh", "i", "", "Recovery times appear after the next refresh", "", "logs"); return; }
        String state = resolved.optString("state");
        if ("absent".equals(state)) { note(rows, "resolved:update", "i", "", "Recovery times need a server update", "", "logs"); return; }
        if (!"ready".equals(state)) { note(rows, "resolved:unavailable", "!", "yellow", "Recently resolved unavailable", resolved.optString("errorCode"), "logs"); return; }
        JSONArray items = resolved.optJSONArray("items");
        if (items == null || items.length() == 0) note(rows, "resolved:none", "•", "", "No problems resolved in the last 24 hours", "", "logs");
        else for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            long start = item.optLong("startedAt", 0), end = item.optLong("resolvedAt", 0);
            boolean retired = "retired".equals(item.optString("resolution"));
            String line = (start > 0 ? clock(start) + " → " + clock(end) + " · " + duration(end - start) : "ended " + clock(end)) + " · " + (retired ? "retired" : "resolved");
            StringBuilder detail = new StringBuilder(severityWord(item.optString("severity"))).append(" until ").append(clock(end));
            if (!item.optString("symptom").isEmpty()) detail.append("\n").append(item.optString("symptom"));
            if (!item.optString("impact").isEmpty()) detail.append("\n").append(item.optString("impact"));
            JSONArray history = item.optJSONArray("history");
            if (history != null) for (int h = 0; h < history.length(); h++) {
                JSONObject entry = history.optJSONObject(h);
                if (entry != null && entry.optLong("at") > 0) detail.append("\n").append(clock(entry.optLong("at"))).append(" ").append(glyph(entry.optString("color"))).append(" ").append(entry.optString("symptom"));
            }
            rows.put(new JSONObject().put("kind", "resolved").put("id", "resolved:" + item.optString("component")).put("glyph", retired ? "–" : "✓").put("color", retired ? "" : "green")
                .put("title", item.optString("component")).put("line", line).put("detail", detail.toString()).put("action", "logs"));
        }
        int more = resolved.optInt("total", 0) - (items == null ? 0 : items.length());
        if (more > 0) note(rows, "resolved:more", "+", "", more + " more resolved in 24h", "open history", "logs");
        if (!resolved.optBoolean("complete", true)) note(rows, "resolved:partial", "i", "", "Older recoveries in the window were not scanned", "open history", "logs");
    }
    /** "More": every row the widget showed before the redesign, in its earlier order. */
    private static void more(JSONArray rows, JSONObject snapshot) throws Exception {
            JSONObject task = snapshot.optJSONObject("task");
            add(rows, "Development", task == null || !task.optBoolean("active") ? "No development task active" + lastTask(task, " · last: ") : task.optString("title") + " · " + task.optString("state") + "\n" + task.optString("phase") + ": " + task.optString("progress"), "task");
            JSONArray recent=snapshot.optJSONArray("recentEntries");
            if(recent==null||recent.length()==0)add(rows, "Latest monitoring entry", snapshot.optString("log", "No scheduled entry yet"), "logs");
            else for(int i=0;i<recent.length();i++){JSONObject entry=recent.getJSONObject(i);add(rows,"Monitoring",entry.optString("summary"),"logs","",clock(entry.optLong("observedAt")));id(rows,"monitoring:"+entry.optLong("observedAt"));}
            add(rows, "Daily report", snapshot.optString("report", "No daily report yet"), "report");
            add(rows, "Cloudflare traffic · past 24h", snapshot.optString("traffic") + snapshot.optString("trafficTime"), "logs");
            usageRows(rows, snapshot.optJSONObject("usage"));
            add(rows, "App statistics", snapshot.optString("games") + "\nBackups " + snapshot.optString("backups") + snapshot.optString("gamesTime"), "logs");
            // Passing checks stay listed here; every check that needs attention is an item above.
            JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
            if (diagnostics != null) for (int i=0; i<diagnostics.length(); i++) {
                JSONObject check = diagnostics.getJSONObject(i);
                String severity = check.has("severity") ? check.optString("severity") : WidgetData.severity(check, "");
                if (!severity.isEmpty()) continue;
                add(rows, check.optString("component"), check.optString("symptom") + "\n" + check.optString("action"), "diagnostics",check.optString("color","yellow"),clock(check.optLong("lastAt",0)));
                id(rows, "diagnostic:" + check.optString("component"));
            }
            add(rows, "Builds and deployments", snapshot.optString("development") + "\n" + snapshot.optString("deployment") + snapshot.optString("developmentTime"), "task");
            String reused = snapshot.optString("reused");
            add(rows, "Shared snapshot " + snapshot.optLong("snapshotId"), "Data collected " + WidgetData.time(snapshot.optLong("checkedAt")) + ". Android delivery may be delayed. Web " + snapshot.optString("commit") + (reused.isEmpty() ? "" : "\nReused provider reading: " + reused + " (the live read was slow)"), "diagnostics","",clock(snapshot.optLong("checkedAt")));
            id(rows, "snapshot");
            add(rows, "Full history, search and export", "Open private monitoring logs and detailed reports in Lootsplitter.", "logs");
    }
    /** Names the row just added: its title carries a value or time that changes between readings. */
    private static void id(JSONArray rows, String id) throws Exception { rows.getJSONObject(rows.length() - 1).put("id", id); }
    /**
     * Gives every row a stable ID (the expanded state of a row is keyed by it, so it must survive a
     * refresh that changes the row's numbers). Rows without an explicit ID use their fixed title;
     * a repeated ID gets "#2", "#3" in order.
     */
    static JSONArray identify(JSONArray rows) {
        java.util.Map<String, Integer> seen = new java.util.HashMap<>();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i); if (row == null) continue;
            String id = row.optString("id"); if (id.isEmpty()) id = row.optString("title");
            Integer count = seen.get(id); seen.put(id, count == null ? 1 : count + 1);
            try { row.put("id", count == null ? id : id + "#" + (count + 1)); } catch (Exception ignored) { }
        }
        return rows;
    }
    /**
     * Cloudflare plan usage: a heading row with the reading time, then one row per metric
     * ("Worker requests today 12,345" / "3.8% of daily share · 7d … · Month …"). A reading cached
     * by an older app version has no usage object and says so.
     */
    static void usageRows(JSONArray rows, JSONObject usage) throws Exception {
        if (usage == null) { add(rows, "Cloudflare plan usage", "Unavailable in this reading · tap Refresh", "logs"); return; }
        boolean ready = "ready".equals(usage.optString("state"));
        add(rows, "Cloudflare plan usage", ready ? usage.optString("summary") : usage.optString("reason", "Cloudflare usage unavailable"), "logs", "", clock(usage.optLong("checkedAt", 0)));
        JSONArray metrics = usage.optJSONArray("rows");
        if (ready && metrics != null) for (int i = 0; i < metrics.length(); i++) {
            JSONObject metric = metrics.optJSONObject(i);
            if (metric == null) continue;
            add(rows, metric.optString("title"), metric.optString("detail"), "logs", metric.optString("color"));
            // The title carries today's value; the metric label is the stable part.
            if (!metric.optString("id").isEmpty()) id(rows, metric.optString("id"));
        }
    }
    /** Stable reorder: red rows, then yellow rows, then everything else in its original order. Nothing is dropped. */
    static JSONArray attentionFirst(JSONArray rows) {
        if (attention(rows) == 0) return rows;
        JSONArray sorted = new JSONArray();
        for (String color : new String[]{"red", "yellow", null})
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i); if (row == null) continue;
                String rowColor = row.optString("color");
                boolean match = color == null ? !"red".equals(rowColor) && !"yellow".equals(rowColor) : color.equals(rowColor);
                if (match) sorted.put(row);
            }
        return sorted;
    }
    static int attention(JSONArray rows) {
        int count = 0;
        for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); String color = row == null ? "" : row.optString("color"); if ("red".equals(color) || "yellow".equals(color)) count++; }
        return count;
    }
    static boolean anyRed(JSONArray rows) {
        for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && "red".equals(row.optString("color"))) return true; }
        return false;
    }
    /** One status glyph per state; shapes differ, not only color. Empty color means no status (neutral dot). */
    static String glyph(String color) { return "red".equals(color) ? "✕" : "green".equals(color) ? "✓" : "yellow".equals(color) ? "!" : "•"; }
    static String statusWord(String color) { return "red".equals(color) ? "Failure" : "green".equals(color) ? "Healthy" : "yellow".equals(color) ? "Needs attention" : "Information"; }
    /** Short reading time: clock only for today, otherwise the dated form. */
    static String clock(long timestamp) {
        if (timestamp <= 0) return "";
        Calendar then = Calendar.getInstance(), now = Calendar.getInstance(); then.setTimeInMillis(timestamp);
        return then.get(Calendar.YEAR) == now.get(Calendar.YEAR) && then.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR)
            ? DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(timestamp)) : WidgetData.time(timestamp);
    }
    private static final Pattern TRAFFIC = Pattern.compile("^(.+) requests / (.+) errors$");
    /** Parses the projected "N requests / M errors" text; null when traffic is unavailable or not connected. */
    static long[] traffic(JSONObject snapshot) {
        Matcher match = TRAFFIC.matcher(snapshot == null ? "" : snapshot.optString("traffic"));
        if (!match.matches()) return null;
        String requests = match.group(1).replaceAll("[^0-9]", ""), errors = match.group(2).replaceAll("[^0-9]", "");
        if (requests.isEmpty() || errors.isEmpty() || requests.length() > 16 || errors.length() > 16) return null;
        return new long[]{Long.parseLong(requests), Long.parseLong(errors)};
    }
    static String compact(long value) {
        if (value < 1000) return Long.toString(value);
        double scaled = value < 1000000 ? value / 1000d : value < 1000000000 ? value / 1000000d : value / 1000000000d;
        String suffix = value < 1000000 ? "k" : value < 1000000000 ? "M" : "B";
        String text = scaled >= 100 ? String.format(Locale.ROOT, "%.0f", Math.floor(scaled)) : String.format(Locale.ROOT, "%.1f", Math.floor(scaled * 10) / 10);
        return (text.endsWith(".0") ? text.substring(0, text.length() - 2) : text) + suffix;
    }
    /**
     * One short reason line. The server reason lists every determining component ("A, B, C");
     * the face shows a count, or the single component with its symptom. The full list stays in
     * the returned description and in each diagnostic row.
     */
    static String[] reason(JSONObject snapshot) {
        String full = snapshot == null ? "" : snapshot.optString("overallReason");
        String color = snapshot == null ? "yellow" : snapshot.optString("statusColor", "yellow");
        JSONArray notes = snapshot == null ? null : snapshot.optJSONArray("overallNotes");
        // Healthy with a coverage limit: a short count on the face, the named limits in the description.
        if (snapshot != null && "green".equals(color) && notes != null && notes.length() > 0)
            return new String[]{"All checks passed · " + notes.length() + (notes.length() == 1 ? " coverage limit" : " coverage limits"), full};
        // Green ("All required checks passed.") and the pre-journal fallback are already one short sentence.
        if (snapshot == null || "green".equals(color) || full.isEmpty() || "Component coverage unavailable".equals(full)) return new String[]{full, full};
        String[] parts = full.split(", ");
        String verb = "red".equals(color) ? " failed" : " need attention";
        String description = parts.length + (parts.length == 1 ? " check" : " checks") + verb + ": " + full + ". Tap for details";
        if (parts.length > 1) return new String[]{parts.length + " checks" + verb + " · tap for details", description};
        String component = parts[0].trim(), symptom = "";
        JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
        if (diagnostics != null) for (int i = 0; i < diagnostics.length(); i++) {
            JSONObject check = diagnostics.optJSONObject(i);
            if (check != null && component.equals(check.optString("component"))) { symptom = brief(check); break; }
        }
        return new String[]{component + (symptom.isEmpty() ? ("red".equals(color) ? " failed" : " needs attention") + " · tap for details" : " · " + symptom), description};
    }
    /** "1 error in 24h · last 8:30 PM" when the server sends a brief; otherwise the full symptom. */
    static String brief(JSONObject check) {
        String brief = check.optString("brief");
        if (brief.isEmpty()) return check.optString("symptom");
        long at = check.optLong("lastAt", 0);
        return brief + (at > 0 ? " · last " + clock(at) : "");
    }
    /** The most recent finished task, so an idle card still says what last ran and how it ended. */
    static String lastTask(JSONObject task, String prefix) {
        if (task == null || task.optString("title").isEmpty()) return "";
        long at = task.optLong("completedAt", 0) > 0 ? task.optLong("completedAt") : task.optLong("heartbeatAt", 0);
        return prefix + task.optString("title") + " · " + task.optString("state") + (at > 0 ? " " + clock(at) : "");
    }
    /** Short face wording for the status WidgetData already computed; the meaning is unchanged. */
    static String status(JSONObject snapshot) {
        String health = snapshot == null ? "" : snapshot.optString("health");
        switch (health) {
            case "CONFIRMED ERROR": return "FAILURE";
            case "STATUS UNVERIFIED": return "UNVERIFIED";
            // A confirmed recent problem that is not current (for example one old Worker error).
            case "NEEDS ATTENTION": return "ATTENTION";
            // A green reading older than OwnerWidgetProvider.STALE_AFTER_MILLIS (35 minutes) is shown amber with its original qualifier.
            case "HEALTHY AT LAST CHECK": return "green".equals(OwnerWidgetProvider.statusColor(snapshot)) ? "HEALTHY" : health;
            default: return health.isEmpty() ? "UNVERIFIED" : health;
        }
    }
    /** Compact relative age for the 4×1 face: now, 4m, 3h, 2d. Future clock skew reads as now. */
    static String age(long timestamp, long now) {
        long minutes = Math.max(0, now - timestamp) / 60000;
        return minutes < 1 ? "now" : minutes < 60 ? minutes + "m" : minutes < 1440 ? (minutes / 60) + "h" : (minutes / 1440) + "d";
    }
    /** Activity glyph colour: ✓ ok, ! running or needing attention, ✕ failure (same rules as status). */
    static String activityColor(JSONObject event) {
        String state = event == null ? "" : event.optString("state");
        return "ok".equals(state) ? "green" : "fail".equals(state) ? "red" : "yellow";
    }
    static String activityWord(JSONObject event) {
        String state = event == null ? "" : event.optString("state");
        return "ok".equals(state) ? "Succeeded" : "fail".equals(state) ? "Failed" : "active".equals(state) ? "In progress" : "Needs attention";
    }
    /** "Merged #138 · Widget redesign · 2m" or "Verify running on #138 · 4m". */
    static String activityLine(JSONObject event, long now) { return activityLine(event, now, true); }
    /**
     * {@code live}: the face re-renders about every minute (a workflow is running), so a relative age
     * stays true. Otherwise renders can be ~30 minutes apart and a relative age would go stale, so
     * the event's clock time is shown instead ("Merged #138 · Widget redesign · 9:41 PM").
     */
    static String activityLine(JSONObject event, long now, boolean live) {
        if (event == null) return "";
        String title = event.optString("title");
        boolean pull = event.optString("kind").startsWith("pr-");
        return event.optString("text") + (pull && !title.isEmpty() ? " · " + title : "") + " · " + (live ? age(event.optLong("at"), now) : clock(event.optLong("at")));
    }
    /** True while the Agent activity fast cadence keeps re-rendering this reading about once a minute. */
    static boolean activityLive(JSONObject snapshot, long now) {
        JSONObject activity = snapshot == null ? null : snapshot.optJSONObject("activity");
        return activity != null && "ready".equals(activity.optString("state")) && activity.optInt("active") > 0
            && now - snapshot.optLong("checkedAt") <= WidgetRefresh.ACTIVITY_MAX_AGE_MILLIS;
    }
    static JSONArray activityEvents(JSONObject snapshot) {
        JSONObject activity = snapshot == null ? null : snapshot.optJSONObject("activity");
        return activity == null || !"ready".equals(activity.optString("state")) ? null : activity.optJSONArray("events");
    }
    static JSONObject latestActivity(JSONObject snapshot) {
        JSONArray events = activityEvents(snapshot);
        return events == null ? null : events.optJSONObject(0);
    }
    /** Second line: a running workflow other than the latest event, otherwise the previous event. */
    static JSONObject nextActivity(JSONObject snapshot) {
        JSONArray events = activityEvents(snapshot);
        if (events == null || events.length() < 2) return null;
        for (int i = 1; i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event != null && "active".equals(event.optString("state"))) return event;
        }
        return events.optJSONObject(1);
    }
    /** Explicit text when there is no event to show: unavailable/disconnected, or a ready empty list. */
    static String activityStatus(JSONObject snapshot) {
        JSONObject activity = snapshot == null ? null : snapshot.optJSONObject("activity");
        if (activity == null) return "GitHub activity unavailable · tap Refresh";
        if (!"ready".equals(activity.optString("state"))) return activity.optString("reason", "GitHub activity unavailable");
        return "No recent GitHub activity";
    }
    static String category(JSONObject snapshot, String category) {
        if (snapshot == null) return "Sign in / refresh";
        JSONObject task = snapshot.optJSONObject("task");
        switch (category) {
            case "activity": { JSONObject latest = latestActivity(snapshot); long now = System.currentTimeMillis(); return latest == null ? activityStatus(snapshot) : WidgetRows.glyph(activityColor(latest)) + " " + activityLine(latest, now, activityLive(snapshot, now)); }
            case "task": return task == null || !task.optBoolean("active") ? "No development task active" + lastTask(task, " · last: ") : task.optString("title") + " · " + task.optString("phase");
            case "timer": return task == null ? "No active task timer" : "Elapsed since " + WidgetData.time(task.optLong("startedAt"));
            case "analytics": return snapshot.optString("active") + " active · " + snapshot.optString("accounts") + " accounts · " + snapshot.optString("campaigns") + " campaigns";
            case "traffic": { long[] counts = traffic(snapshot); return counts == null ? snapshot.optString("traffic") : compact(counts[0]) + " req · " + compact(counts[1]) + " err · 24h"; }
            case "log": return snapshot.optString("log", "No log yet");
            case "warning": return snapshot.optString("warning").isEmpty() ? reason(snapshot)[0] : snapshot.optString("warning");
            case "report": return snapshot.optString("report", "No report yet");
            case "incident": return incident(snapshot);
            case "summary": return summary(snapshot);
            default: return status(snapshot) + " · " + ("green".equals(snapshot.optString("statusColor")) ? "all checks" : reason(snapshot)[0]);
        }
    }
    /** The worst active item (not info): its severity, title and duration, or "ALL CLEAR · 21 checks". */
    static JSONObject worst(JSONObject snapshot) {
        for (JSONObject item : attentionItems(snapshot)) if (!"info".equals(item.optString("severity"))) return item;
        return null;
    }
    /** "CRIT · Worker execution errors · 31m" / "ALL CLEAR · 21 checks" / the status word when unverified. */
    static String incident(JSONObject snapshot) {
        JSONObject item = worst(snapshot);
        if (item != null) {
            long started = item.optLong("startedAt", 0);
            return chip(item.optString("severity")).substring(2) + " · " + item.optString("title") + (started > 0 ? " · " + duration(snapshot.optLong("checkedAt") - started) : "");
        }
        if (!"green".equals(OwnerWidgetProvider.statusColor(snapshot))) return status(snapshot) + " · " + reason(snapshot)[0];
        JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
        int checks = diagnostics == null ? 0 : diagnostics.length();
        return "ALL CLEAR" + (checks > 0 ? " · " + checks + (checks == 1 ? " check" : " checks") : "");
    }
    /** Severity colour of the incident line: the worst item's, green when clear, the status colour otherwise. */
    static String incidentSeverity(JSONObject snapshot) {
        JSONObject item = worst(snapshot);
        return item != null ? item.optString("severity") : "green".equals(OwnerWidgetProvider.statusColor(snapshot)) ? "" : "warning";
    }
    /** "! 1 warn · ✓ 2 resolved 24h" (counts that are not zero, then recoveries); no reading time (the caller adds it). */
    static String summary(JSONObject snapshot) {
        int[] counts = counts(snapshot);
        java.util.List<String> parts = new java.util.ArrayList<>();
        if (counts[0] > 0) parts.add("✕ " + counts[0] + " crit");
        if (counts[1] > 0) parts.add("! " + counts[1] + " warn");
        JSONObject resolved = snapshot.optJSONObject("resolved");
        if (resolved != null && "ready".equals(resolved.optString("state"))) parts.add("✓ " + resolved.optInt("total", 0) + " resolved 24h");
        else if (resolved != null && "absent".equals(resolved.optString("state"))) parts.add("recoveries: server update");
        if (counts[0] == 0 && counts[1] == 0) parts.add(snapshot.optString("active", "—") + " online");
        return android.text.TextUtils.join(" · ", parts);
    }
    static String action(String category,JSONObject snapshot) { if("incident".equals(category)||"summary".equals(category)) return "diagnostics"; if("activity".equals(category)) return "activity"; if("warning".equals(category) && (snapshot==null||snapshot.optString("warning").isEmpty())) return "diagnostics"; return "report".equals(category) ? "report" : "task".equals(category) || "timer".equals(category) || "warning".equals(category) ? "task" : "health".equals(category) ? "diagnostics" : "logs"; }
}
