package com.unregisteredmusket.lootsplit;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

public class OwnerWidgetProvider extends AppWidgetProvider {
    static final String REFRESH = "com.unregisteredmusket.lootsplit.WIDGET_REFRESH";
    static final String OPEN = "lootsplit_owner_widget";

    static int[] ids(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, OwnerWidgetProvider.class));
    }
    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : ids(context)) render(context, manager, id, manager.getAppWidgetOptions(id));
    }
    static void render(Context context, AppWidgetManager manager, int id, Bundle options) {
        JSONObject state = WidgetStore.read(context);
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> layouts = new LinkedHashMap<>();
            layouts.put(new SizeF(250, 300), views(context, state, false));
            layouts.put(new SizeF(250, 480), views(context, state, true));
            manager.updateAppWidget(id, new RemoteViews(layouts));
        } else {
            boolean portrait = context.getResources().getConfiguration().orientation != android.content.res.Configuration.ORIENTATION_LANDSCAPE;
            int height = options.getInt(portrait ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 480);
            manager.updateAppWidget(id, views(context, state, height >= 480));
        }
    }

    static RemoteViews views(Context context, JSONObject state, boolean expanded) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.owner_widget);
        view.setViewVisibility(R.id.monitor_details, expanded ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.monitor_services, expanded ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.monitor_development_time, expanded ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.monitor_release, expanded ? View.VISIBLE : View.GONE);
        view.setViewVisibility(R.id.monitor_deployment, expanded ? View.VISIBLE : View.GONE);
        JSONObject snapshot = state.optJSONObject("snapshot");
        // A cached snapshot is explicitly dated; old cache is cleared on the next host render.
        if (snapshot != null && System.currentTimeMillis() - snapshot.optLong("checkedAt") > 3600000) snapshot = null;
        boolean connected = !state.optString("token").isEmpty();
        if (!connected) snapshot = null;
        text(view, R.id.monitor_identity, snapshot == null ? "OWNER ACCESS" : "OWNER ACCESS  /  " + snapshot.optString("name"));
        text(view, R.id.monitor_email, snapshot == null ? "Tap to open My account" : snapshot.optString("email"));
        text(view, R.id.monitor_health, snapshot == null ? (connected ? "AWAITING CHECK" : "CONNECT ACCOUNT") : snapshot.optString("health"));
        view.setTextColor(R.id.monitor_health, snapshot != null && snapshot.optBoolean("healthy") ? Color.rgb(19, 245, 128) : Color.rgb(238, 199, 113));
        text(view, R.id.monitor_services, snapshot == null ? state.optString("message", "Tap refresh to check") : snapshot.optString("services"));
        text(view, R.id.monitor_active, value(snapshot, "active"));
        text(view, R.id.monitor_totals, "ACCOUNTS " + value(snapshot, "accounts") + "    CAMPAIGNS " + value(snapshot, "campaigns"));
        text(view, R.id.monitor_traffic, snapshot == null ? "Unavailable" : snapshot.optString("traffic"));
        text(view, R.id.monitor_traffic_time, "LAST 24 HOURS" + (snapshot == null ? "" : snapshot.optString("trafficTime")));
        text(view, R.id.monitor_game, snapshot == null ? "Unavailable" : snapshot.optString("games"));
        text(view, R.id.monitor_game_time, "SHARED CAMPAIGNS" + (snapshot == null ? "" : snapshot.optString("gamesTime")));
        text(view, R.id.monitor_backups, "CLOUD BACKUPS  " + value(snapshot, "backups"));
        text(view, R.id.monitor_development, snapshot == null ? "Development unavailable" : expanded
            ? snapshot.optString("development") : snapshot.optString("development") + " / " + snapshot.optString("deployment"));
        text(view, R.id.monitor_deployment, snapshot == null ? "Deployment unavailable" : snapshot.optString("deployment"));
        text(view, R.id.monitor_development_time, "RECENT GITHUB ACTIVITY" + (snapshot == null ? "" : snapshot.optString("developmentTime")));
        text(view, R.id.monitor_release, "WEB " + value(snapshot, "commit") + "  /  APP " + appVersion(context));
        text(view, R.id.monitor_checked, snapshot == null ? "No current reading" : "Checked " + WidgetData.time(snapshot.optLong("checkedAt")));
        Intent open = new Intent(context, MainActivity.class).putExtra(OPEN, true)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent account = PendingIntent.getActivity(context, 197400, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        view.setOnClickPendingIntent(R.id.monitor_account, account);
        view.setOnClickPendingIntent(R.id.monitor_open, account);
        view.setOnClickPendingIntent(R.id.monitor_refresh, PendingIntent.getBroadcast(context, 197401,
            new Intent(context, OwnerWidgetProvider.class).setAction(REFRESH).addFlags(Intent.FLAG_RECEIVER_FOREGROUND),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return view;
    }
    private static String appVersion(Context context) {
        try { return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
        catch (Exception ignored) { return "—"; }
    }
    private static String value(JSONObject snapshot, String key) { return snapshot == null ? "—" : snapshot.optString(key, "—"); }
    private static void text(RemoteViews view, int id, String text) {
        view.setTextViewText(id, text);
        view.setContentDescription(id, text);
    }
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAll(context);
        OwnerWidgetJob.schedule(context);
    }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id, options);
    }
    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (REFRESH.equals(intent.getAction())) {
            JSONObject state = WidgetStore.read(context);
            try { WidgetStore.finish(context, state.optString("generation"), null, "Refresh queued · waiting for network"); }
            catch (Exception ignored) { /* Storage fails closed. */ }
            renderAll(context);
            OwnerWidgetJob.schedule(context);
        }
    }
    @Override public void onDisabled(Context context) {
        OwnerWidgetJob.cancel(context);
        WidgetStore.clear(context, null);
    }
}
