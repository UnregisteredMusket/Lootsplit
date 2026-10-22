package com.unregisteredmusket.lootsplit;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONArray;
import org.json.JSONObject;

public class OwnerWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext(), intent.getStringExtra("generation"),intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID,-1)); }
    static final class Factory implements RemoteViewsFactory {
        final Context context; final String generation; final int id; JSONArray rows = new JSONArray(); java.util.Set<String> expanded = new java.util.HashSet<>();
        Factory(Context context, String generation) { this(context,generation,-1); }
        Factory(Context context, String generation,int id) { this.context=context; this.generation=generation; this.id=id; }
        public void onCreate() { onDataSetChanged(); }
        public void onDestroy() { rows = new JSONArray(); }
        public void onDataSetChanged() {
            JSONObject state = WidgetStore.read(context);
            rows = WidgetRows.rows(generation != null && generation.equals(state.optString("generation")) ? OwnerWidgetProvider.current(state) : null);
            // Expanded rows survive a refresh by row ID; IDs no longer in the reading are pruned.
            expanded = WidgetRowState.prune(context, id, rows);
        }
        public int getCount() { return rows.length(); }
        public RemoteViews getViewAt(int position) {
            JSONObject state = WidgetStore.read(context);
            JSONObject row = rows.optJSONObject(position);
            if (generation == null || !generation.equals(state.optString("generation")) || OwnerWidgetProvider.current(state) == null) row = WidgetRows.rows(null).optJSONObject(0);
            return rowView(context, row, id, row != null && expanded.contains(row.optString("id")));
        }
        public RemoteViews getLoadingView() { return rowView(context, null,id); }
        /** Compact and expanded row layouts. */
        public int getViewTypeCount() { return 2; }
        public long getItemId(int position) { return position; }
        public boolean hasStableIds() { return false; }
    }
    static RemoteViews rowView(Context context, JSONObject row, int id) { return rowView(context, row, id, false); }
    /**
     * One log row. Compact: one ellipsized title and detail line with ▾. Expanded (after a tap):
     * the full title and every detail line, ▴, and an OPEN button for the row's app destination.
     * Tapping the row toggles it (OwnerWidgetProvider.ROW_TAP); the loading row opens My account.
     */
    static RemoteViews rowView(Context context, JSONObject row, int id, boolean expanded) {
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
        String action=row==null?"account":row.optString("action");
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
