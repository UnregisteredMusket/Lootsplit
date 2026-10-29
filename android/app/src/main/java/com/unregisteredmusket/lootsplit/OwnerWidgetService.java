package com.unregisteredmusket.lootsplit;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class OwnerWidgetService extends RemoteViewsService {
    /**
     * Distinct top-level layouts in the Field monitor list (compact and expanded log rows, section,
     * attention item, resolved line or note, tile row and strip). RemoteCollectionItems and the
     * API 24–30 factory both declare this count.
     */
    static final int VIEW_TYPES = 7;
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext(), intent.getStringExtra("generation"),intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID,-1)); }
    static final class Factory implements RemoteViewsFactory {
        final Context context; final String generation; final int id; JSONArray rows = new JSONArray(); Set<String> expanded = new java.util.HashSet<>();
        Factory(Context context, String generation) { this(context,generation,-1); }
        Factory(Context context, String generation,int id) { this.context=context; this.generation=generation; this.id=id; }
        public void onCreate() { onDataSetChanged(); }
        public void onDestroy() { rows = new JSONArray(); }
        public void onDataSetChanged() {
            JSONObject state = WidgetStore.read(context);
            JSONObject snapshot = generation != null && generation.equals(state.optString("generation")) ? OwnerWidgetProvider.current(state) : null;
            // Expanded rows and tiles survive a refresh by ID; IDs no longer in the reading are pruned.
            expanded = WidgetRowState.prune(context, id, WidgetRows.rows(snapshot, WidgetRowState.expanded(context, id)));
            rows = snapshot == null ? WidgetRows.placeholder(context, state) : WidgetRows.rows(snapshot, expanded);
        }
        public int getCount() { return rows.length(); }
        public RemoteViews getViewAt(int position) {
            JSONObject state = WidgetStore.read(context);
            JSONObject row = rows.optJSONObject(position);
            if (generation == null || !generation.equals(state.optString("generation")) || OwnerWidgetProvider.current(state) == null) row = WidgetRows.placeholder(context, state).optJSONObject(0);
            return rowView(context, row, id, expanded);
        }
        public RemoteViews getLoadingView() { return rowView(context, null,id); }
        public int getViewTypeCount() { return VIEW_TYPES; }
        public long getItemId(int position) { return position; }
        public boolean hasStableIds() { return false; }
    }
    static RemoteViews rowView(Context context, JSONObject row, int id) { return rowView(context, row, id, false); }
    static RemoteViews rowView(Context context, JSONObject row, int id, boolean expanded) {
        Set<String> set = new java.util.HashSet<>();
        if (expanded && row != null) set.add(row.optString("id"));
        return rowView(context, row, id, set);
    }
    /** One list row of any kind; {@code expanded} holds the expanded row and tile IDs of this widget. */
    static RemoteViews rowView(Context context, JSONObject row, int id, Set<String> expanded) {
        boolean light = WidgetAppearance.light(context, id);
        String kind = row == null ? "row" : row.optString("kind", "row");
        boolean open = row != null && expanded != null && expanded.contains(row.optString("id"));
        try {
            switch (kind) {
                case "section": return section(context, row, light);
                case "item": return item(context, row, open, light);
                case "resolved": case "note": return resolved(context, row, open, light);
                case "tiles": return WidgetTiles.tilesRow(context, row, id, light);
                case "strip": return WidgetTiles.stripRow(context, row, id, light);
                default: break;
            }
        } catch (Exception ignored) { /* Falls back to the plain row below, which cannot fail. */ }
        return logRow(context, row, id, open);
    }

    private static RemoteViews section(Context context, JSONObject row, boolean light) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_section);
        WidgetCharts.Palette p = WidgetCharts.Palette.of(light);
        view.setInt(R.id.widget_row, "setBackgroundColor", p.background);
        view.setTextViewText(R.id.section_title, row.optString("title").toUpperCase(java.util.Locale.ROOT));
        view.setTextColor(R.id.section_title, p.faint);
        view.setTextViewText(R.id.section_detail, row.optString("detail"));
        view.setTextColor(R.id.section_detail, p.muted);
        view.setContentDescription(R.id.widget_row, row.optString("title") + (row.optString("detail").isEmpty() ? "" : ", " + row.optString("detail")));
        return view;
    }

    /**
     * An attention item: severity chip (shape and word: ✕ CRIT, ! WARN, i INFO), title, ACTIVE tag
     * (NOTE for info), meta line. Expanded: severity reason, start/duration/last, evidence, symptom,
     * the 6-hour error chart (Worker errors), next action and DIAGNOSTICS / HISTORY / REPORT links.
     */
    private static RemoteViews item(Context context, JSONObject row, boolean open, boolean light) throws Exception {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_item);
        WidgetCharts.Palette p = WidgetCharts.Palette.of(light);
        String severity = row.optString("severity", "warning");
        int tone = p.severity(severity);
        view.setInt(R.id.widget_row, "setBackgroundColor", p.background);
        view.setInt(R.id.item_box, "setBackgroundResource", open ? (light ? R.drawable.item_tile_outlined_light : R.drawable.item_tile_outlined_dark) : (light ? R.drawable.item_tile_light : R.drawable.item_tile_dark));
        view.setTextViewText(R.id.item_chip, WidgetRows.chip(severity)); view.setTextColor(R.id.item_chip, tone);
        view.setTextViewText(R.id.item_title, row.optString("title")); view.setTextColor(R.id.item_title, p.ink);
        view.setInt(R.id.item_title, "setMaxLines", open ? 3 : 1);
        view.setTextViewText(R.id.item_tag, row.optString("tag", "ACTIVE"));
        view.setInt(R.id.item_tag, "setBackgroundColor", tone); view.setTextColor(R.id.item_tag, p.background);
        view.setTextViewText(R.id.item_meta, row.optString("meta")); view.setTextColor(R.id.item_meta, p.muted);
        view.setInt(R.id.item_meta, "setMaxLines", open ? 3 : 1);
        view.setTextViewText(R.id.item_chevron, open ? "▴" : "▾"); view.setTextColor(R.id.item_chevron, p.muted);
        view.setViewVisibility(R.id.item_more, open ? View.VISIBLE : View.GONE);
        String description = WidgetRows.severityWord(severity) + ", " + row.optString("tag", "ACTIVE").toLowerCase(java.util.Locale.ROOT) + ". " + row.optString("title") + ". " + row.optString("meta")
            + ". " + row.optString("detail").replace("\n", ". ") + (open ? " Expanded; tap to collapse." : " Tap to expand.");
        view.setContentDescription(R.id.widget_row, description);
        view.setOnClickFillInIntent(R.id.widget_row, new Intent().putExtra(OwnerWidgetProvider.ROW_ID, row.optString("id")));
        if (!open) return view;
        view.setTextViewText(R.id.item_lines, row.optString("lines")); view.setTextColor(R.id.item_lines, p.ink);
        view.setTextViewText(R.id.item_next, row.optString("next")); view.setTextColor(R.id.item_next, p.muted);
        view.setViewVisibility(R.id.item_next, row.optString("next").isEmpty() ? View.GONE : View.VISIBLE);
        JSONArray chart = row.optJSONArray("chart");
        boolean drawn = chart != null && chart.length() > 0;
        view.setViewVisibility(R.id.item_chart, drawn ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.item_axis, drawn ? View.VISIBLE : View.GONE);
        if (drawn) {
            Long[] values = new Long[chart.length()]; long total = 0; StringBuilder spoken = new StringBuilder();
            for (int i = 0; i < values.length; i++) { Object v = chart.opt(i); values[i] = v instanceof Number ? ((Number) v).longValue() : null; if (values[i] != null) total += values[i]; spoken.append(i == 0 ? "" : ", ").append(values[i] == null ? "not measured" : Long.toString(values[i])); }
            view.setImageViewBitmap(R.id.item_chart, WidgetCharts.errorBars(values, 330, 26, context.getResources().getDisplayMetrics().density, p));
            view.setContentDescription(R.id.item_chart, "Errors per half-hour, last 6 hours, " + total + " in total: " + spoken);
            view.setTextColor(R.id.item_axis_start, p.faint); view.setTextColor(R.id.item_axis_end, p.faint);
        }
        JSONArray buttons = row.optJSONArray("buttons");
        int[] ids = {R.id.item_button1, R.id.item_button2, R.id.item_button3};
        // Above the default font scale three buttons no longer fit one row; the third (REPORT) gives way
        // rather than text shrinking or clipping (design plan M5). The daily report stays in the strip and More.
        int shown = OwnerWidgetProvider.largeFont(context) ? 2 : ids.length;
        for (int i = 0; i < ids.length; i++) {
            JSONArray button = buttons == null || i >= shown ? null : buttons.optJSONArray(i);
            view.setViewVisibility(ids[i], button == null ? View.GONE : View.VISIBLE);
            if (button == null) continue;
            String action = WidgetActions.rowAction(button.optString(1));
            view.setTextViewText(ids[i], button.optString(0));
            view.setTextColor(ids[i], light ? p.ink : p.ok);
            view.setContentDescription(ids[i], "Open " + WidgetActions.rowLabel(action) + " in Lootsplitter");
            view.setOnClickFillInIntent(ids[i], new Intent().putExtra(WidgetActions.DESTINATION, action));
        }
        return view;
    }

    /** A Recently resolved line (✓ title · start → end · duration · resolved; expands to its history) or a note. */
    private static RemoteViews resolved(Context context, JSONObject row, boolean open, boolean light) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_resolved);
        WidgetCharts.Palette p = WidgetCharts.Palette.of(light);
        boolean note = "note".equals(row.optString("kind"));
        String color = row.optString("color");
        view.setInt(R.id.widget_row, "setBackgroundColor", p.background);
        view.setTextViewText(R.id.resolved_glyph, row.optString("glyph", "✓"));
        view.setTextColor(R.id.resolved_glyph, "green".equals(color) ? p.ok : "yellow".equals(color) ? p.warn : "red".equals(color) ? p.crit : p.faint);
        view.setTextViewText(R.id.resolved_title, row.optString("title")); view.setTextColor(R.id.resolved_title, note ? p.muted : p.ink);
        view.setInt(R.id.resolved_title, "setMaxLines", open ? 3 : 1);
        view.setTextViewText(R.id.resolved_line, row.optString("line")); view.setTextColor(R.id.resolved_line, p.muted);
        view.setViewVisibility(R.id.resolved_line, row.optString("line").isEmpty() ? View.GONE : View.VISIBLE);
        view.setViewVisibility(R.id.resolved_chevron, note ? View.GONE : View.VISIBLE);
        view.setTextViewText(R.id.resolved_chevron, open ? "▴" : "▾"); view.setTextColor(R.id.resolved_chevron, p.muted);
        view.setViewVisibility(R.id.resolved_detail, open && !note ? View.VISIBLE : View.GONE);
        view.setTextViewText(R.id.resolved_detail, row.optString("detail")); view.setTextColor(R.id.resolved_detail, p.muted);
        String spoken = (note ? "" : "–".equals(row.optString("glyph")) ? "Retired: " : "Resolved: ") + row.optString("title") + (row.optString("line").isEmpty() ? "" : ", " + row.optString("line"))
            + (note ? "" : open ? ". " + row.optString("detail").replace("\n", ". ") + " Expanded; tap to collapse." : ". Tap to expand.");
        view.setContentDescription(R.id.widget_row, spoken);
        if (note) { if (!row.optString("action").isEmpty()) view.setOnClickFillInIntent(R.id.widget_row, new Intent().putExtra(WidgetActions.DESTINATION, row.optString("action"))); }
        else view.setOnClickFillInIntent(R.id.widget_row, new Intent().putExtra(OwnerWidgetProvider.ROW_ID, row.optString("id")));
        return view;
    }

    /**
     * One log row (the rows listed under More). Compact: one ellipsized title and detail line with ▾.
     * Expanded (after a tap): the full title and every detail line, ▴, and an OPEN button for the
     * row's app destination. Tapping the row toggles it (OwnerWidgetProvider.ROW_TAP); the loading row opens My account.
     */
    static RemoteViews logRow(Context context, JSONObject row, int id, boolean expanded) {
        RemoteViews view = new RemoteViews(context.getPackageName(), expanded ? R.layout.owner_widget_row_expanded : R.layout.owner_widget_row);
        boolean light=WidgetAppearance.light(context,id);
        int ink=android.graphics.Color.rgb(32,72,51);
        int text=light?ink:android.graphics.Color.rgb(230,248,236), muted=light?ink:android.graphics.Color.rgb(177,214,193);
        view.setInt(R.id.widget_row,"setBackgroundColor",light?android.graphics.Color.rgb(247,242,228):android.graphics.Color.rgb(7,23,18));
        String color=row==null?"":row.optString("color");
        boolean status="red".equals(color)||"yellow".equals(color)||"green".equals(color);
        String title=row == null ? "Loading…" : row.optString("title");
        String detail=row == null ? "Dated owner information" : row.optString("detail");
        String time=row == null ? "" : row.optString("time");
        // Status glyph column: ✓ ! ✕ in the row's color, a neutral dot when the row has no status.
        view.setTextViewText(R.id.widget_row_glyph,WidgetRows.glyph(status?color:""));
        view.setTextColor(R.id.widget_row_glyph,status?OwnerWidgetProvider.color(color,light):muted);
        view.setContentDescription(R.id.widget_row_glyph,WidgetRows.statusWord(status?color:""));
        view.setTextViewText(R.id.widget_row_title,title);view.setTextColor(R.id.widget_row_title,text);
        view.setViewVisibility(R.id.widget_row_time,time.isEmpty()?android.view.View.GONE:android.view.View.VISIBLE);
        view.setTextViewText(R.id.widget_row_time,time);view.setTextColor(R.id.widget_row_time,muted);
        // Compact: one visible line (the complete text stays in the row description). Expanded: every line.
        view.setTextViewText(R.id.widget_row_detail,expanded?detail:detail.replace("\n"," · "));view.setTextColor(R.id.widget_row_detail,muted);
        view.setTextColor(R.id.widget_row_chevron,muted);
        String rowId=row==null?"":row.optString("id");
        String action=row==null?OwnerWidgetProvider.CONNECT:row.optString("action");
        boolean toggles=!rowId.isEmpty();
        view.setContentDescription(R.id.widget_row,(status?WidgetRows.statusWord(color)+". ":"")+title+(time.isEmpty()?"":", "+time)+". "+detail.replace("\n",". ")
            +(toggles?(expanded?" Expanded; tap to collapse.":" Tap to expand."):""));
        view.setViewVisibility(R.id.widget_row_chevron,toggles?android.view.View.VISIBLE:android.view.View.GONE);
        // Row tap: toggle this row (by its stable ID). A row without an ID (loading) keeps opening the app.
        view.setOnClickFillInIntent(R.id.widget_row, toggles ? new Intent().putExtra(OwnerWidgetProvider.ROW_ID, rowId) : new Intent().putExtra(WidgetActions.DESTINATION, action));
        if (expanded) {
            String label=WidgetActions.rowLabel(action);
            view.setTextViewText(R.id.widget_row_open,"OPEN "+label.toUpperCase(java.util.Locale.ROOT)+" ›");
            view.setTextColor(R.id.widget_row_open,light?ink:android.graphics.Color.rgb(19,245,128));
            view.setContentDescription(R.id.widget_row_open,"Open "+label+" in Lootsplitter");
            view.setOnClickFillInIntent(R.id.widget_row_open, new Intent().putExtra(WidgetActions.DESTINATION, action));
        }
        return view;
    }
}
