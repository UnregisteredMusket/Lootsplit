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
        CompanionWidgetProvider.renderAll(context);
        manager.notifyAppWidgetViewDataChanged(ids(context), R.id.monitor_list);
    }
    static JSONObject current(JSONObject state) {
        JSONObject snapshot = state.optJSONObject("snapshot");
        if (state.optString("token").isEmpty() || snapshot == null || System.currentTimeMillis()-snapshot.optLong("checkedAt")>3600000) return null;
        return snapshot;
    }
    static String statusColor(JSONObject snapshot) {
        if(snapshot==null)return "yellow";
        String color=snapshot.optString("statusColor","yellow");
        return "red".equals(color)?"red":System.currentTimeMillis()-snapshot.optLong("checkedAt")>120000?"yellow":color;
    }
    static int color(String value) { return "red".equals(value)?Color.rgb(244,114,114):"green".equals(value)?Color.rgb(19,245,128):Color.rgb(238,199,113); }
    static void render(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, WidgetStore.read(context), true, id));
    }
    static RemoteViews views(Context context, JSONObject state, boolean expanded) { return views(context,state,expanded,-1); }
    static RemoteViews views(Context context, JSONObject state, boolean expanded, int id) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.owner_widget);
        boolean light=WidgetAppearance.light(context,id);
        view.setInt(R.id.monitor_root,"setBackgroundColor",light?Color.rgb(247,242,228):Color.rgb(7,23,18));
        if(light) for(int target: new int[]{R.id.monitor_title,R.id.monitor_identity,R.id.monitor_email,R.id.monitor_services,R.id.monitor_active,R.id.monitor_totals,R.id.monitor_development,R.id.monitor_timer,R.id.monitor_checked,R.id.monitor_open,R.id.monitor_refresh}) view.setTextColor(target,light?Color.rgb(32,72,51):Color.rgb(177,214,193));
        JSONObject snapshot=current(state),task=snapshot==null?null:snapshot.optJSONObject("task");
        boolean connected=!state.optString("token").isEmpty(); String message=state.optString("message");
        boolean refreshing=connected&&"Refreshing…".equals(message);
        text(view,R.id.monitor_identity,snapshot==null?"OWNER ACCESS":"OWNER ACCESS / "+snapshot.optString("name"));
        text(view,R.id.monitor_email,snapshot==null?"Tap Sign in to connect your owner account":snapshot.optString("email"));
        text(view,R.id.monitor_health,refreshing?"REFRESHING":snapshot==null?(connected?"AWAITING CHECK":"SIGN IN REQUIRED"):message.isEmpty()?snapshot.optString("health"):"LAST KNOWN STATUS");
        view.setTextColor(R.id.monitor_health,color(statusColor(snapshot)));
        text(view,R.id.monitor_services,!message.isEmpty()?message:snapshot==null?"No current reading":snapshot.optString("overallReason"));
        text(view,R.id.monitor_active,snapshot==null?"—":snapshot.optString("active"));
        text(view,R.id.monitor_totals,snapshot==null?"ACCOUNT ACTIVITY · PAST 5 MINUTES":"ACTIVE · 5 MINUTES   /   ACCOUNTS "+snapshot.optString("accounts")+"   /   CAMPAIGNS "+snapshot.optString("campaigns"));
        text(view,R.id.monitor_development,task==null||!task.optBoolean("active")?"No development task active":task.optString("title")+" · "+task.optString("phase")+" · "+task.optString("state"));
        view.setViewVisibility(R.id.monitor_timer,task==null?View.GONE:View.VISIBLE);
        if(task!=null) { long start=task.optLong("startedAt"),end=task.optLong("completedAt",0); view.setChronometer(R.id.monitor_timer,android.os.SystemClock.elapsedRealtime()-Math.max(0,(end>0?end:System.currentTimeMillis())-start),"Total elapsed %s",end==0&&task.optBoolean("active")); }
        view.setOnClickPendingIntent(R.id.monitor_development,WidgetActions.pending(context,id,"task",false));
        view.setOnClickPendingIntent(R.id.monitor_timer,WidgetActions.pending(context,id,"task",false));
        org.json.JSONArray rows=WidgetRows.rows(snapshot);
        if(Build.VERSION.SDK_INT>=31) {
            RemoteViews.RemoteCollectionItems.Builder items=new RemoteViews.RemoteCollectionItems.Builder().setViewTypeCount(1).setHasStableIds(false);
            for(int i=0;i<rows.length();i++)items.addItem(i,OwnerWidgetService.rowView(context,rows.optJSONObject(i),id));
            view.setRemoteAdapter(R.id.monitor_list,items.build());
        } else {
            Intent service=new Intent(context,OwnerWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).putExtra("generation",state.optString("generation"));
            service.setData(android.net.Uri.parse("lootsplit-widget://collection/"+id+"/"+state.optString("generation","empty")));
            view.setRemoteAdapter(R.id.monitor_list,service);
        }
        Intent template=new Intent(context,MainActivity.class).putExtra(OPEN,true).setData(android.net.Uri.parse("lootsplit-widget://collection-open/"+id)).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        view.setPendingIntentTemplate(R.id.monitor_list,PendingIntent.getActivity(context,230000+Math.max(0,id),template,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0)));
        text(view,R.id.monitor_checked,snapshot==null?"No current reading":(message.isEmpty()?"Checked ":"Last reading ")+WidgetData.time(snapshot.optLong("checkedAt"))+" · #"+snapshot.optLong("snapshotId"));
        view.setOnClickPendingIntent(R.id.monitor_account,WidgetActions.pending(context,id,"account",false));
        text(view,R.id.monitor_open,connected?"LOGS / REPORTS":"SIGN IN");
        view.setOnClickPendingIntent(R.id.monitor_open,WidgetActions.pending(context,id,connected?"logs":"account",false));
        view.setOnClickPendingIntent(R.id.monitor_refresh,WidgetActions.pending(context,id,"refresh",false));
        return view;
    }
    private static void text(RemoteViews view,int id,String text) { view.setTextViewText(id,text);view.setContentDescription(id,text); }
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
            PendingResult pending = goAsync();
            WidgetRefresh.request(context, true, error -> pending.finish());
        }
    }
    @Override public void onDeleted(Context context,int[] ids){ for(int id:ids)CompanionSettings.remove(context,id); }
    @Override public void onDisabled(Context context) {
        if (CompanionWidgetProvider.ids(context).length == 0) {
            OwnerWidgetJob.cancel(context);
            WidgetStore.clear(context, null);
        }
    }
}
