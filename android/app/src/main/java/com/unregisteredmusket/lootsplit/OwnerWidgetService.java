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
        final Context context; final String generation; final int id; JSONArray rows = new JSONArray();
        Factory(Context context, String generation) { this(context,generation,-1); }
        Factory(Context context, String generation,int id) { this.context=context; this.generation=generation; this.id=id; }
        public void onCreate() { onDataSetChanged(); }
        public void onDestroy() { rows = new JSONArray(); }
        public void onDataSetChanged() {
            JSONObject state = WidgetStore.read(context);
            rows = WidgetRows.rows(generation != null && generation.equals(state.optString("generation")) ? OwnerWidgetProvider.current(state) : null);
        }
        public int getCount() { return rows.length(); }
        public RemoteViews getViewAt(int position) {
            JSONObject state = WidgetStore.read(context);
            JSONObject row = rows.optJSONObject(position);
            if (generation == null || !generation.equals(state.optString("generation")) || OwnerWidgetProvider.current(state) == null) row = WidgetRows.rows(null).optJSONObject(0);
            return rowView(context, row,id);
        }
        public RemoteViews getLoadingView() { return rowView(context, null,id); }
        public int getViewTypeCount() { return 1; }
        public long getItemId(int position) { return position; }
        public boolean hasStableIds() { return false; }
    }
    static RemoteViews rowView(Context context, JSONObject row, int id) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget_row);
        boolean light=WidgetAppearance.light(context,id);
        int ink=light?android.graphics.Color.rgb(32,72,51):android.graphics.Color.rgb(177,214,193);
        view.setInt(R.id.widget_row,"setBackgroundColor",light?android.graphics.Color.rgb(247,242,228):android.graphics.Color.rgb(7,23,18));
        String color=row==null?"":row.optString("color");
        view.setTextColor(R.id.widget_row_title,color.isEmpty()?ink:OwnerWidgetProvider.color(color,light));view.setTextColor(R.id.widget_row_detail,ink);
        view.setTextViewText(R.id.widget_row_title, row == null ? "Loading…" : row.optString("title"));
        view.setTextViewText(R.id.widget_row_detail, row == null ? "Dated owner information" : row.optString("detail"));
        view.setOnClickFillInIntent(R.id.widget_row, new Intent().putExtra(WidgetActions.DESTINATION, row == null ? "account" : row.optString("action")));
        return view;
    }
}
