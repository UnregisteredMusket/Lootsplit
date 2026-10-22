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
    static JSONArray rows(JSONObject snapshot) {
        JSONArray rows = new JSONArray();
        try {
            if (snapshot == null) { add(rows, "No current owner reading", "Sign in or tap Refresh. Backend logging continues independently.", "account"); return rows; }
            JSONObject task = snapshot.optJSONObject("task");
            add(rows, "Development", task == null || !task.optBoolean("active") ? "No development task active" + lastTask(task, " · last: ") : task.optString("title") + " · " + task.optString("state") + "\n" + task.optString("phase") + ": " + task.optString("progress"), "task");
            if (!snapshot.optString("warning").isEmpty()) add(rows, "Development warning", snapshot.optString("warning"), "task", "yellow");
            JSONArray recent=snapshot.optJSONArray("recentEntries");
            if(recent==null||recent.length()==0)add(rows, "Latest monitoring entry", snapshot.optString("log", "No scheduled entry yet"), "logs");
            else for(int i=0;i<recent.length();i++){JSONObject entry=recent.getJSONObject(i);add(rows,"Monitoring",entry.optString("summary"),"logs","",clock(entry.optLong("observedAt")));}
            add(rows, "Daily report", snapshot.optString("report", "No daily report yet"), "report");
            add(rows, "Cloudflare traffic · past 24h", snapshot.optString("traffic") + snapshot.optString("trafficTime"), "logs");
            add(rows, "App statistics", snapshot.optString("games") + "\nBackups " + snapshot.optString("backups") + snapshot.optString("gamesTime"), "logs");
            JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
            if (diagnostics != null) for (int i=0; i<diagnostics.length(); i++) {
                JSONObject check = diagnostics.getJSONObject(i);
                // A coverage limit (by-design gap) stays listed as information, not attention.
                boolean limit=check.optBoolean("coverageLimit",false);
                String color=limit?"":check.optString("color","yellow");
                add(rows, check.optString("component") + (limit ? " · coverage limit" : ""), check.optString("symptom") + "\n" + check.optString("action"), "diagnostics",color,clock(check.optLong("lastAt",0)));
            }
            add(rows, "Builds and deployments", snapshot.optString("development") + "\n" + snapshot.optString("deployment") + snapshot.optString("developmentTime"), "task");
            add(rows, "Shared snapshot " + snapshot.optLong("snapshotId"), "Data collected " + WidgetData.time(snapshot.optLong("checkedAt")) + ". Android delivery may be delayed. Web " + snapshot.optString("commit"), "diagnostics","",clock(snapshot.optLong("checkedAt")));
            add(rows, "Full history, search and export", "Open private monitoring logs and detailed reports in Lootsplit.", "logs");
        } catch (Exception ignored) { }
        return attentionFirst(rows);
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
            // A green reading older than two minutes is shown amber with its original qualifier.
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
            default: return status(snapshot) + " · " + ("green".equals(snapshot.optString("statusColor")) ? "all checks" : reason(snapshot)[0]);
        }
    }
    static String action(String category,JSONObject snapshot) { if("activity".equals(category)) return "activity"; if("warning".equals(category) && (snapshot==null||snapshot.optString("warning").isEmpty())) return "diagnostics"; return "report".equals(category) ? "report" : "task".equals(category) || "timer".equals(category) || "warning".equals(category) ? "task" : "health".equals(category) ? "diagnostics" : "logs"; }
}
