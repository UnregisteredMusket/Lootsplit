package com.unregisteredmusket.lootsplit;
import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Which main-widget log rows are expanded, per widget instance, keyed by the stable row ID from
 * {@link WidgetRows#rows}. Presentation only: row IDs name a row kind ("report", "diagnostic:GitHub",
 * "monitoring:1761170000000"), never a credential or reading. IDs that a newer reading no longer
 * contains are pruned when the rows are rendered.
 */
final class WidgetRowState {
    private static final String FILE = "widget-row-expansion";
    private WidgetRowState() { }
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences(FILE, Context.MODE_PRIVATE); }
    private static String key(int id) { return "expanded-" + id; }
    static synchronized Set<String> expanded(Context context, int id) {
        Set<String> out = new HashSet<>();
        try {
            JSONArray saved = new JSONArray(preferences(context).getString(key(id), "[]"));
            for (int i = 0; i < saved.length(); i++) if (!saved.optString(i).isEmpty()) out.add(saved.optString(i));
        } catch (Exception ignored) { }
        return out;
    }
    private static void save(Context context, int id, Set<String> rows) {
        SharedPreferences.Editor edit = preferences(context).edit();
        if (rows.isEmpty()) edit.remove(key(id)); else edit.putString(key(id), new JSONArray(rows).toString());
        // commit(): the render that follows a tap (possibly in the collection service) must see it.
        edit.commit();
    }
    /** Flips one row and returns its new state (true = expanded). */
    static synchronized boolean toggle(Context context, int id, String row) {
        Set<String> rows = expanded(context, id);
        boolean expanded = !rows.remove(row);
        if (expanded) rows.add(row);
        save(context, id, rows);
        return expanded;
    }
    /** Expanded IDs still present in {@code rows}; IDs of rows that no longer exist are dropped and saved. */
    static synchronized Set<String> prune(Context context, int id, JSONArray rows) {
        Set<String> saved = expanded(context, id), present = new HashSet<>();
        if (saved.isEmpty()) return saved;
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null && saved.contains(row.optString("id"))) present.add(row.optString("id"));
        }
        if (present.size() != saved.size() && id >= 0) save(context, id, present);
        return present;
    }
    static synchronized void remove(Context context, int id) { preferences(context).edit().remove(key(id)).commit(); }
}
