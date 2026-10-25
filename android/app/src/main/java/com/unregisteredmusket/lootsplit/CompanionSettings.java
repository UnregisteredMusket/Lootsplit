package com.unregisteredmusket.lootsplit;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/** Presentation preferences only: no identity, credential or private snapshot is stored here. */
final class CompanionSettings {
    static final String[] CATEGORIES = {"health", "analytics", "traffic", "task", "timer", "log", "warning", "report", "activity", "incident", "summary"};
    /**
     * Agent activity is the default for new and existing companions (owner decision 5, 2026-10-25);
     * every earlier preset stays selectable. "Status + charts" (the redesign) is an extra choice.
     */
    static final String[] PRESETS = {"Agent activity", "Development", "Server Health", "Analytics", "Quick Actions", "Status + charts"};
    /** The chart column (requests sparkline over its error baseline, main-run pips): off unless chosen. */
    static final String[] CHARTS = {"off", "on"};
    static final String DEFAULT_PRESET = "Agent activity";
    /** Unsaved companions placed before Agent activity existed keep rendering this earlier default. */
    static final String LEGACY_DEFAULT = "Development";
    static final String[] THEMES = {"terminal", "light", "dark", "system"};
    private static final String FILE = "widget-presentation", DEFAULTS_V2 = "defaults-v2";
    static JSONObject preset(String name) {
        JSONObject out = new JSONObject();
        try {
            if ("Status + charts".equals(name)) {
                // Line 1: the worst active item with severity and duration; line 2: counts, recoveries, reading time.
                out.put("first", "incident").put("second", "summary").put("charts", "on");
            } else if ("Agent activity".equals(name)) {
                // Line 1: latest GitHub action; line 2: the running workflow or the previous event.
                out.put("first", "activity").put("second", "activity");
            } else {
                out.put("first", "Development".equals(name) ? "task" : "Analytics".equals(name) ? "analytics" : "health");
                out.put("second", "Development".equals(name) ? "timer" : "Analytics".equals(name) ? "traffic" : "Server Health".equals(name) ? "warning" : "report");
            }
            if (!out.has("charts")) out.put("charts", "off");
            out.put("action1", "refresh").put("action2", "Quick Actions".equals(name) ? "account" : "Status + charts".equals(name) ? "logs" : "settings").put("theme", "terminal");
        } catch (Exception ignored) { }
        return out;
    }
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences(FILE, Context.MODE_PRIVATE); }
    static JSONObject read(Context context, int id) {
        try { return new JSONObject(preferences(context).getString("instance-"+id, preset(DEFAULT_PRESET).toString())); }
        catch (Exception ignored) { return preset(DEFAULT_PRESET); }
    }
    static void save(Context context, int id, JSONObject value) { preferences(context).edit().putString("instance-"+id, value.toString()).commit(); }
    static void remove(Context context, int id) { preferences(context).edit().remove("instance-"+id).apply(); }
    static boolean showsCharts(JSONObject settings) { return settings != null && "on".equals(settings.optString("charts")); }
    static boolean showsActivity(JSONObject settings) {
        return settings != null && ("activity".equals(settings.optString("first")) || "activity".equals(settings.optString("second")));
    }
    /**
     * One-time, upgrade-only: companions already placed without saved settings were showing the
     * Development default, so that choice is written down for them instead of silently switching
     * them to Agent activity. A fresh install has no earlier companions and saves nothing.
     */
    static void preserveLegacyDefaults(Context context) {
        if (preferences(context).getBoolean(DEFAULTS_V2, false)) return;
        boolean upgraded;
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            upgraded = info.lastUpdateTime > info.firstInstallTime;
        } catch (Exception ignored) { upgraded = true; }
        preserveLegacyDefaults(context, CompanionWidgetProvider.ids(context), upgraded);
    }
    static synchronized void preserveLegacyDefaults(Context context, int[] placed, boolean upgraded) {
        SharedPreferences preferences = preferences(context);
        if (preferences.getBoolean(DEFAULTS_V2, false)) return;
        SharedPreferences.Editor edit = preferences.edit();
        if (upgraded) for (int id : placed)
            if (!preferences.contains("instance-"+id)) edit.putString("instance-"+id, preset(LEGACY_DEFAULT).toString());
        edit.putBoolean(DEFAULTS_V2, true).commit();
    }
}
