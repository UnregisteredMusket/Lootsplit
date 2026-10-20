package com.unregisteredmusket.lootsplit;
import org.json.JSONArray;
import org.json.JSONObject;

final class WidgetRows {
    static void add(JSONArray rows, String title, String detail, String action) throws Exception {
        add(rows,title,detail,action,"");
    }
    static void add(JSONArray rows, String title, String detail, String action, String color) throws Exception {
        rows.put(new JSONObject().put("title", title).put("detail", detail).put("action", action).put("color",color));
    }
    static JSONArray rows(JSONObject snapshot) {
        JSONArray rows = new JSONArray();
        try {
            if (snapshot == null) { add(rows, "No current owner reading", "Sign in or tap Refresh. Backend logging continues independently.", "account"); return rows; }
            JSONObject task = snapshot.optJSONObject("task");
            add(rows, "Development", task == null || !task.optBoolean("active") ? "No development task active" : task.optString("title") + " · " + task.optString("state") + "\n" + task.optString("phase") + ": " + task.optString("progress"), "task");
            if (!snapshot.optString("warning").isEmpty()) add(rows, "⚠ Development warning", snapshot.optString("warning"), "task", "yellow");
            JSONArray recent=snapshot.optJSONArray("recentEntries");
            if(recent==null||recent.length()==0)add(rows, "Latest monitoring entry", snapshot.optString("log", "No scheduled entry yet"), "logs");
            else for(int i=0;i<recent.length();i++){JSONObject entry=recent.getJSONObject(i);add(rows,"Monitoring · "+WidgetData.time(entry.optLong("observedAt")),entry.optString("summary"),"logs");}
            add(rows, "Daily report", snapshot.optString("report", "No daily report yet"), "report");
            add(rows, "Cloudflare traffic · past 24h", snapshot.optString("traffic") + snapshot.optString("trafficTime"), "logs");
            add(rows, "App statistics", snapshot.optString("games") + "\nBackups " + snapshot.optString("backups") + snapshot.optString("gamesTime"), "logs");
            JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
            if (diagnostics != null) for (int i=0; i<diagnostics.length(); i++) {
                JSONObject check = diagnostics.getJSONObject(i);
                String color=check.optString("color","yellow");
                String icon="red".equals(color)?"!":"green".equals(color)?"✓":"?";
                add(rows, icon+" "+color.toUpperCase(java.util.Locale.ROOT) + " · " + check.optString("component"), check.optString("symptom") + "\n" + check.optString("action"), "diagnostics",color);
            }
            add(rows, "Builds and deployments", snapshot.optString("development") + "\n" + snapshot.optString("deployment") + snapshot.optString("developmentTime"), "task");
            add(rows, "Shared snapshot " + snapshot.optLong("snapshotId"), "Data collected " + WidgetData.time(snapshot.optLong("checkedAt")) + ". Android delivery may be delayed. Web " + snapshot.optString("commit"), "diagnostics");
            add(rows, "Full history, search and export", "Open private monitoring logs and detailed reports in Lootsplit.", "logs");
        } catch (Exception ignored) { }
        return rows;
    }
    static String category(JSONObject snapshot, String category) {
        if (snapshot == null) return "Sign in / refresh";
        JSONObject task = snapshot.optJSONObject("task");
        switch (category) {
            case "task": return task == null || !task.optBoolean("active") ? "No development task active" : task.optString("title") + " · " + task.optString("phase");
            case "timer": return task == null ? "No active task timer" : "Elapsed since " + WidgetData.time(task.optLong("startedAt"));
            case "analytics": return snapshot.optString("active") + " active · " + snapshot.optString("accounts") + " accounts";
            case "traffic": return snapshot.optString("traffic");
            case "log": return snapshot.optString("log", "No log yet");
            case "warning": return snapshot.optString("warning").isEmpty() ? snapshot.optString("overallReason") : snapshot.optString("warning");
            case "report": return snapshot.optString("report", "No report yet");
            default: return snapshot.optString("health") + " · " + snapshot.optString("overallReason");
        }
    }
    static String action(String category,JSONObject snapshot) { if("warning".equals(category) && (snapshot==null||snapshot.optString("warning").isEmpty())) return "diagnostics"; return "report".equals(category) ? "report" : "task".equals(category) || "timer".equals(category) || "warning".equals(category) ? "task" : "health".equals(category) ? "diagnostics" : "logs"; }
}
