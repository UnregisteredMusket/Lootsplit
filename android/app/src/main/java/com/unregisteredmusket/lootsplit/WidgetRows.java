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
            add(rows, "Development", task == null || !task.optBoolean("active") ? "No development task active" : task.optString("title") + " · " + task.optString("state") + "\n" + task.optString("phase") + ": " + task.optString("progress"), "task");
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
                String color=check.optString("color","yellow");
                add(rows, check.optString("component"), check.optString("symptom") + "\n" + check.optString("action"), "diagnostics",color);
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
            if (check != null && component.equals(check.optString("component"))) { symptom = check.optString("symptom"); break; }
        }
        return new String[]{component + (symptom.isEmpty() ? ("red".equals(color) ? " failed" : " needs attention") + " · tap for details" : " · " + symptom), description};
    }
    /** Short face wording for the status WidgetData already computed; the meaning is unchanged. */
    static String status(JSONObject snapshot) {
        String health = snapshot == null ? "" : snapshot.optString("health");
        switch (health) {
            case "CONFIRMED ERROR": return "FAILURE";
            case "STATUS UNVERIFIED": return "UNVERIFIED";
            // A green reading older than two minutes is shown amber with its original qualifier.
            case "HEALTHY AT LAST CHECK": return "green".equals(OwnerWidgetProvider.statusColor(snapshot)) ? "HEALTHY" : health;
            default: return health.isEmpty() ? "UNVERIFIED" : health;
        }
    }
    static String category(JSONObject snapshot, String category) {
        if (snapshot == null) return "Sign in / refresh";
        JSONObject task = snapshot.optJSONObject("task");
        switch (category) {
            case "task": return task == null || !task.optBoolean("active") ? "No development task active" : task.optString("title") + " · " + task.optString("phase");
            case "timer": return task == null ? "No active task timer" : "Elapsed since " + WidgetData.time(task.optLong("startedAt"));
            case "analytics": return snapshot.optString("active") + " active · " + snapshot.optString("accounts") + " accounts · " + snapshot.optString("campaigns") + " campaigns";
            case "traffic": { long[] counts = traffic(snapshot); return counts == null ? snapshot.optString("traffic") : compact(counts[0]) + " req · " + compact(counts[1]) + " err · 24h"; }
            case "log": return snapshot.optString("log", "No log yet");
            case "warning": return snapshot.optString("warning").isEmpty() ? reason(snapshot)[0] : snapshot.optString("warning");
            case "report": return snapshot.optString("report", "No report yet");
            default: return status(snapshot) + " · " + ("green".equals(snapshot.optString("statusColor")) ? "all checks" : reason(snapshot)[0]);
        }
    }
    static String action(String category,JSONObject snapshot) { if("warning".equals(category) && (snapshot==null||snapshot.optString("warning").isEmpty())) return "diagnostics"; return "report".equals(category) ? "report" : "task".equals(category) || "timer".equals(category) || "warning".equals(category) ? "task" : "health".equals(category) ? "diagnostics" : "logs"; }
}
