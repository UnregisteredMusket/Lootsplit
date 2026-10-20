package com.unregisteredmusket.lootsplit;
import android.content.Context;
import org.json.JSONObject;

/** Presentation preferences only: no identity, credential or private snapshot is stored here. */
final class CompanionSettings {
    static final String[] CATEGORIES = {"health", "analytics", "traffic", "task", "timer", "log", "warning", "report"};
    static final String[] PRESETS = {"Development", "Server Health", "Analytics", "Quick Actions"};
    static final String[] THEMES = {"terminal", "light", "dark", "system"};
    static JSONObject preset(String name) {
        JSONObject out = new JSONObject();
        try {
            out.put("first", "Development".equals(name) ? "task" : "Analytics".equals(name) ? "analytics" : "health");
            out.put("second", "Development".equals(name) ? "timer" : "Analytics".equals(name) ? "traffic" : "Server Health".equals(name) ? "warning" : "report");
            out.put("action1", "refresh").put("action2", "Quick Actions".equals(name) ? "account" : "settings").put("theme", "terminal");
        } catch (Exception ignored) { }
        return out;
    }
    static JSONObject read(Context context, int id) {
        try { return new JSONObject(context.getSharedPreferences("widget-presentation", Context.MODE_PRIVATE).getString("instance-"+id, preset("Development").toString())); }
        catch (Exception ignored) { return preset("Development"); }
    }
    static void save(Context context, int id, JSONObject value) { context.getSharedPreferences("widget-presentation", Context.MODE_PRIVATE).edit().putString("instance-"+id, value.toString()).commit(); }
    static void remove(Context context, int id) { context.getSharedPreferences("widget-presentation", Context.MODE_PRIVATE).edit().remove("instance-"+id).apply(); }
}
