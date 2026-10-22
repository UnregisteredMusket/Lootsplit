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
        WidgetRefresh.scheduleActivity(context); // Arms or cancels the Agent activity fast cadence.
    }
    static JSONObject current(JSONObject state) {
        JSONObject snapshot = state.optJSONObject("snapshot");
        if (state.optString("token").isEmpty() || snapshot == null || System.currentTimeMillis()-snapshot.optLong("checkedAt")>3600000) return null;
        return snapshot;
    }
    /**
     * A healthy reading older than this is drawn amber ("HEALTHY AT LAST CHECK"). Background delivery
     * is about every 30 minutes, so 35 minutes keeps a normally refreshed widget green while still
     * marking a missed refresh. The web dashboard, which polls continuously, keeps its two-minute rule.
     * Readings over an hour old are hidden entirely (current()).
     */
    static final long STALE_AFTER_MILLIS = 35L * 60000;
    static String statusColor(JSONObject snapshot) { return statusColor(snapshot, System.currentTimeMillis()); }
    static String statusColor(JSONObject snapshot, long now) {
        if(snapshot==null)return "yellow";
        String color=snapshot.optString("statusColor","yellow");
        return "red".equals(color)?"red":now-snapshot.optLong("checkedAt")>STALE_AFTER_MILLIS?"yellow":color;
    }
    static int color(String value,boolean light) { return light ? "red".equals(value)?Color.rgb(157,42,42):"green".equals(value)?Color.rgb(21,112,62):Color.rgb(133,91,8) : color(value); }
    static int color(String value) { return "red".equals(value)?Color.rgb(244,114,114):"green".equals(value)?Color.rgb(19,245,128):Color.rgb(238,199,113); }
    static void render(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, views(context, WidgetStore.read(context), true, id));
    }
    static RemoteViews views(Context context, JSONObject state, boolean expanded) { return views(context,state,expanded,-1); }
    static RemoteViews views(Context context, JSONObject state, boolean expanded, int id) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.owner_widget);
        boolean light=WidgetAppearance.light(context,id);
        int ink=Color.rgb(32,72,51), text=light?ink:Color.rgb(230,248,236), muted=light?ink:Color.rgb(177,214,193), accent=light?ink:Color.rgb(19,245,128);
        JSONObject snapshot=current(state),task=snapshot==null?null:snapshot.optJSONObject("task");
        // A busy Keystore keeps the saved connection: show Refresh/retry, not Sign in.
        boolean connected=!state.optString("token").isEmpty()||state.optBoolean(WidgetStore.UNAVAILABLE); String message=state.optString("message");
        boolean refreshing=connected&&"Refreshing…".equals(message);
        String status=statusColor(snapshot); boolean failure=snapshot!=null&&"red".equals(status);
        org.json.JSONArray rows=WidgetRows.rows(snapshot);
        // Root: the existing opaque theme fill; a confirmed failure swaps in the red-bordered variant.
        if(failure) view.setInt(R.id.monitor_root,"setBackgroundResource",light?R.drawable.monitor_background_alert_light:R.drawable.monitor_background_alert);
        else view.setInt(R.id.monitor_root,"setBackgroundColor",light?Color.rgb(247,242,228):Color.rgb(7,23,18));
        // Set both themes explicitly: hosts may reapply onto views that kept the previous theme's colors.
        for(int target: new int[]{R.id.monitor_title,R.id.monitor_active,R.id.monitor_accounts,R.id.monitor_campaigns,R.id.monitor_timer,R.id.monitor_open,R.id.monitor_refresh}) view.setTextColor(target,accent);
        for(int target: new int[]{R.id.monitor_checked,R.id.monitor_active_label,R.id.monitor_accounts_label,R.id.monitor_campaigns_label,R.id.monitor_list_label,R.id.monitor_identity}) view.setTextColor(target,muted);

        // 1. Header reading time (full dated wording stays in the description).
        view.setTextViewText(R.id.monitor_checked,snapshot==null?"—":WidgetRows.clock(snapshot.optLong("checkedAt")));
        view.setContentDescription(R.id.monitor_checked,snapshot==null?"No current reading":(message.isEmpty()?"Checked ":"Last reading ")+WidgetData.time(snapshot.optLong("checkedAt"))+" · #"+snapshot.optLong("snapshotId"));

        // 2. Status glyph, word and one reason line.
        boolean signedOut=snapshot==null&&!connected;
        glyph(view,R.id.monitor_glyph,signedOut?"":status,light,false);
        text(view,R.id.monitor_health,refreshing?"REFRESHING":snapshot==null?(connected?"AWAITING CHECK":"SIGN IN REQUIRED"):message.isEmpty()?WidgetRows.status(snapshot):"LAST KNOWN STATUS");
        view.setTextColor(R.id.monitor_health,color(status,light));
        String[] reason=WidgetRows.reason(snapshot);
        view.setTextViewText(R.id.monitor_services,!message.isEmpty()?message:snapshot==null?(connected?"No current reading · tap Refresh":"Tap Sign in to connect your owner account"):reason[0]);
        view.setContentDescription(R.id.monitor_services,!message.isEmpty()?message:snapshot==null?"No current reading":reason[1]);
        view.setTextColor(R.id.monitor_services,failure&&!light?text:muted);
        view.setOnClickPendingIntent(R.id.monitor_status,WidgetActions.pending(context,id,snapshot==null?"account":"diagnostics",false));

        // 3. Stats strip. Missing values stay "—", never 0.
        tile(view,R.id.monitor_active,snapshot==null?"—":snapshot.optString("active","—"),"Active accounts in the past 5 minutes");
        tile(view,R.id.monitor_accounts,snapshot==null?"—":snapshot.optString("accounts","—"),"Accounts");
        tile(view,R.id.monitor_campaigns,snapshot==null?"—":snapshot.optString("campaigns","—"),"Shared campaigns");
        long[] traffic=WidgetRows.traffic(snapshot);
        // The error tile follows the Worker errors check: red only for current/unexplained errors,
        // amber for a recent error that has stopped. Older servers without the check keep "any error = red".
        String errorsState=snapshot==null?"":snapshot.optString("errorsState");
        boolean recentErrors=traffic!=null&&traffic[1]>0&&"warning".equals(errorsState);
        boolean errors=traffic!=null&&traffic[1]>0&&!recentErrors&&!"healthy".equals(errorsState);
        view.setTextViewText(R.id.monitor_requests,traffic==null?"—":WidgetRows.compact(traffic[0]));
        view.setTextViewText(R.id.monitor_requests_label,traffic==null?"REQ · — ERR":"REQ · "+WidgetRows.compact(traffic[1])+" ERR");
        view.setContentDescription(R.id.monitor_requests,traffic==null?"Requests in the past 24 hours: "+(snapshot==null?"no current reading":snapshot.optString("traffic")):"Requests in the past 24 hours: "+traffic[0]+", errors: "+traffic[1]+(recentErrors?", none in the latest half-hour":""));
        view.setInt(R.id.monitor_tile_requests,"setBackgroundResource",errors?R.drawable.stat_tile_alert:R.drawable.stat_tile);
        view.setTextColor(R.id.monitor_requests,errors?color("red",light):accent);
        view.setTextColor(R.id.monitor_requests_label,errors&&!light?text:recentErrors?color("yellow",light):muted);
        view.setOnClickPendingIntent(R.id.monitor_tile_requests,WidgetActions.pending(context,id,"logs",false));

        // 4. Task strip.
        boolean active=task!=null&&task.optBoolean("active");
        String warning=snapshot==null?"":snapshot.optString("warning");
        if(active) {
            android.text.SpannableString line=new android.text.SpannableString("▶ "+task.optString("state").toUpperCase(java.util.Locale.ROOT)+" · "+task.optString("phase"));
            line.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD),0,line.length(),android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            view.setTextViewText(R.id.monitor_development,line);
        } else view.setTextViewText(R.id.monitor_development,"No development task active");
        view.setTextColor(R.id.monitor_development,active?text:muted);
        view.setContentDescription(R.id.monitor_development,active?task.optString("title")+" · "+task.optString("phase")+" · "+task.optString("state"):"No development task active");
        // Idle: name the last task and how it ended (completed, failed, interrupted) with its time.
        String detail=!warning.isEmpty()?"! "+warning:active?task.optString("title")+" · "+task.optString("progress"):WidgetRows.lastTask(task,"Last: ");
        view.setViewVisibility(R.id.monitor_task_detail,detail.isEmpty()?View.GONE:View.VISIBLE);
        view.setTextViewText(R.id.monitor_task_detail,detail);
        view.setContentDescription(R.id.monitor_task_detail,!warning.isEmpty()?"Warning: "+warning:detail);
        view.setTextColor(R.id.monitor_task_detail,!warning.isEmpty()?color("yellow",light):muted);
        view.setInt(R.id.monitor_task,"setBackgroundResource",!warning.isEmpty()?R.drawable.task_card_warn:R.drawable.task_card);
        view.setViewVisibility(R.id.monitor_timer,task==null?View.GONE:View.VISIBLE);
        if(task!=null) {
            long start=task.optLong("startedAt"),end=task.optLong("completedAt",0);
            view.setChronometer(R.id.monitor_timer,android.os.SystemClock.elapsedRealtime()-Math.max(0,(end>0?end:System.currentTimeMillis())-start),"%s",end==0&&task.optBoolean("active"));
            view.setContentDescription(R.id.monitor_timer,"Total elapsed since "+WidgetData.time(start));
        }
        view.setOnClickPendingIntent(R.id.monitor_task,WidgetActions.pending(context,id,"task",false));
        view.setOnClickPendingIntent(R.id.monitor_development,WidgetActions.pending(context,id,"task",false));
        view.setOnClickPendingIntent(R.id.monitor_timer,WidgetActions.pending(context,id,"task",false));

        // 5. Log label and collection; attention rows are already ordered first.
        boolean attention=WidgetRows.attention(rows)>0;
        view.setTextViewText(R.id.monitor_list_label,attention?"NEEDS ATTENTION FIRST":"LOG");
        view.setInt(R.id.monitor_list_rule,"setBackgroundColor",WidgetRows.anyRed(rows)?(light?Color.rgb(157,42,42):Color.argb(89,244,114,114)):(light?ink:Color.argb(64,91,236,160)));
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

        // 6. Footer: identity (no email on the face), LOGS and REFRESH.
        view.setTextViewText(R.id.monitor_identity,snapshot==null?"OWNER · SIGN IN":"OWNER · "+snapshot.optString("name")+" · #"+snapshot.optLong("snapshotId"));
        view.setContentDescription(R.id.monitor_account,snapshot==null?"Owner access. Sign in in My account":"Owner access, "+snapshot.optString("name")+". Open My account");
        view.setOnClickPendingIntent(R.id.monitor_account,WidgetActions.pending(context,id,"account",false));
        view.setTextViewText(R.id.monitor_open,connected?"LOGS":"SIGN IN");
        view.setContentDescription(R.id.monitor_open,connected?"Open logs and reports":"Sign in");
        view.setOnClickPendingIntent(R.id.monitor_open,WidgetActions.pending(context,id,connected?"logs":"account",false));
        view.setOnClickPendingIntent(R.id.monitor_refresh,WidgetActions.pending(context,id,"refresh",false));
        return view;
    }
    /** Status glyph box shared by both widgets: ✓ / ! / ✕ (shapes differ), "–" when there is no status. */
    static void glyph(RemoteViews view,int target,String color,boolean light,boolean fillHealthy) {
        boolean red="red".equals(color),green="green".equals(color),yellow="yellow".equals(color);
        int box=red?(light?R.drawable.glyph_box_fail_light:R.drawable.glyph_box_fail)
            :green?(fillHealthy?(light?R.drawable.glyph_box_ok_filled_light:R.drawable.glyph_box_ok_filled):(light?R.drawable.glyph_box_ok_light:R.drawable.glyph_box_ok))
            :yellow?(light?R.drawable.glyph_box_warn_light:R.drawable.glyph_box_warn)
            :(light?R.drawable.glyph_box_none_light:R.drawable.glyph_box_none);
        view.setInt(target,"setBackgroundResource",box);
        view.setTextViewText(target,red||green||yellow?WidgetRows.glyph(color):"–");
        boolean filled=red||green&&fillHealthy;
        view.setTextColor(target,filled?(light?Color.rgb(247,242,228):Color.rgb(11,17,14)):red||green||yellow?color(color,light):(light?Color.rgb(32,72,51):Color.rgb(177,214,193)));
    }
    private static void tile(RemoteViews view,int id,String value,String label) {
        view.setTextViewText(id,value);view.setContentDescription(id,label+": "+("—".equals(value)?"unavailable":value));
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
        } else if (WidgetRefresh.ACTIVITY_TICK.equals(intent.getAction())) {
            // Background (not manual) check: the same coalescing, deadline and account checks apply.
            PendingResult pending = goAsync();
            if (!WidgetRefresh.activityTick(context, error -> pending.finish())) pending.finish();
        }
    }
    @Override public void onDeleted(Context context,int[] ids){ for(int id:ids)CompanionSettings.remove(context,id); }
    @Override public void onDisabled(Context context) {
        if (CompanionWidgetProvider.ids(context).length == 0) {
            OwnerWidgetJob.cancel(context);
            WidgetRefresh.cancelActivity(context);
            WidgetStore.clear(context, null);
        }
    }
}
