package com.unregisteredmusket.lootsplit;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;

public class CompanionWidgetProvider extends AppWidgetProvider {
    static int[] ids(Context context) { return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context,CompanionWidgetProvider.class)); }
    static void renderAll(Context context) { CompanionSettings.preserveLegacyDefaults(context); for(int id:ids(context)) AppWidgetManager.getInstance(context).updateAppWidget(id,views(context,WidgetStore.read(context),CompanionSettings.read(context,id),id)); }
    static RemoteViews views(Context context, JSONObject state, JSONObject settings, int id) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.companion_widget);
        JSONObject snapshot=OwnerWidgetProvider.current(state), task=snapshot==null?null:snapshot.optJSONObject("task");
        String theme=settings.optString("theme","terminal"); boolean light="light".equals(theme)||"system".equals(theme)&&(context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)!=android.content.res.Configuration.UI_MODE_NIGHT_YES;
        int ink=light?Color.rgb(32,53,46):Color.rgb(230,248,236), muted=light?Color.rgb(32,53,46):Color.rgb(177,214,193), tint=light?Color.rgb(32,72,51):Color.rgb(19,245,128);
        view.setInt(R.id.companion_root,"setBackgroundColor",light?Color.rgb(247,242,228):Color.rgb(7,23,18));
        // A busy Keystore keeps the saved connection: show Refresh/retry, not Sign in.
        boolean connected=!state.optString("token").isEmpty()||state.optBoolean(WidgetStore.UNAVAILABLE); String message=state.optString("message");
        String status=OwnerWidgetProvider.statusColor(snapshot);
        String first=settings.optString("first","task"),second=settings.optString("second","timer");
        long now=System.currentTimeMillis();
        boolean firstActivity=snapshot!=null&&"activity".equals(first), secondActivity=snapshot!=null&&"activity".equals(second);
        JSONObject latest=WidgetRows.latestActivity(snapshot);
        if(firstActivity) {
            // Agent activity: the glyph is the latest GitHub event's state (✓ ok, ! running/attention, ✕ failure);
            // an unavailable source is "!", a successfully read empty list is the neutral "–".
            boolean empty=latest==null&&WidgetRows.activityEvents(snapshot)!=null;
            String activityColor=latest!=null?WidgetRows.activityColor(latest):empty?"":"yellow";
            OwnerWidgetProvider.glyph(view,R.id.companion_light,activityColor,light,true);
            view.setContentDescription(R.id.companion_light,"GitHub activity: "+(latest!=null?WidgetRows.activityWord(latest):empty?"no recent events":"unavailable")+"; open the activity list");
            view.setOnClickPendingIntent(R.id.companion_light,WidgetActions.pending(context,id,"activity",true));
        } else {
        // Status glyph: same rules as the main widget; filled ✓ when healthy, muted "–" when signed out.
        OwnerWidgetProvider.glyph(view,R.id.companion_light,snapshot==null&&!connected?"":status,light,true);
        view.setContentDescription(R.id.companion_light,snapshot==null&&!connected?"Owner sign-in needed. Open My account":WidgetRows.statusWord(status)+" status; open diagnostics for the reason");
        view.setOnClickPendingIntent(R.id.companion_light,WidgetActions.pending(context,id,snapshot==null&&!connected?"account":"diagnostics",true));
        }
        boolean firstTimer="timer".equals(first)&&task!=null, secondTimer="timer".equals(second)&&task!=null;
        String warning=snapshot==null?"":snapshot.optString("warning");
        if(snapshot==null) {
            // Signed out or awaiting a reading: both lines lead to My account.
            view.setTextViewText(R.id.companion_first,connected?"Awaiting owner reading":"Owner sign-in needed");
            view.setTextColor(R.id.companion_first,ink);
            String detail=connected?(message.isEmpty()?"Tap Refresh to check now":message):(message.isEmpty()||"Connect in My account".equals(message)?"Tap to connect in My account":message);
            view.setTextViewText(R.id.companion_second,detail);
            view.setTextColor(R.id.companion_second,!message.isEmpty()&&!"Connect in My account".equals(message)?OwnerWidgetProvider.color("yellow",light):muted);
            view.setOnClickPendingIntent(R.id.companion_first,WidgetActions.pending(context,id,"account",true));
            view.setOnClickPendingIntent(R.id.companion_second,WidgetActions.pending(context,id,"account",true));
            view.setContentDescription(R.id.companion_first,"OWNER · SIGN IN. "+(connected?"Awaiting owner reading":"Owner sign-in needed"));
            view.setContentDescription(R.id.companion_second,detail);
            view.setViewVisibility(R.id.companion_timer,View.GONE);
        } else {
            if(firstActivity) {
                String primary=latest==null?WidgetRows.activityStatus(snapshot):WidgetRows.activityLine(latest,now,WidgetRows.activityLive(snapshot,now));
                view.setTextViewText(R.id.companion_first,primary);
                view.setTextColor(R.id.companion_first,latest==null&&WidgetRows.activityEvents(snapshot)==null?OwnerWidgetProvider.color("yellow",light):ink);
                view.setContentDescription(R.id.companion_first,"OWNER · "+snapshot.optString("name")+". GitHub activity. "+(latest==null?primary:WidgetRows.activityWord(latest)+": "+primary+". At "+WidgetData.time(latest.optLong("at"))));
                view.setOnClickPendingIntent(R.id.companion_first,WidgetActions.pending(context,id,"activity",true));
            } else {
            String primary=WidgetRows.category(snapshot,first);
            view.setTextViewText(R.id.companion_first,primary);
            view.setTextColor(R.id.companion_first,"health".equals(first)?OwnerWidgetProvider.color(status,light):ink);
            view.setContentDescription(R.id.companion_first,"OWNER · "+snapshot.optString("name")+". "+primary);
            view.setOnClickPendingIntent(R.id.companion_first,WidgetActions.pending(context,id,WidgetRows.action(first,snapshot),true));
            }
            if(secondActivity) activitySecond(context,view,snapshot,firstActivity,message,light,muted,now,id);
            else {
            // With the timer on line 1, line 2 carries the warning when there is one.
            boolean warningLine=secondTimer&&!warning.isEmpty();
            String secondary=warningLine?warning:WidgetRows.category(snapshot,second);
            boolean amber=warningLine||"warning".equals(second)&&(!warning.isEmpty()||!"green".equals(snapshot.optString("statusColor")));
            String reading=(message.isEmpty()?"":"Last reading ")+WidgetRows.clock(snapshot.optLong("checkedAt"));
            view.setTextViewText(R.id.companion_second,secondary+" · "+reading);
            view.setTextColor(R.id.companion_second,amber?OwnerWidgetProvider.color("yellow",light):muted);
            view.setContentDescription(R.id.companion_second,(amber?"Warning: ":"")+secondary+". As of "+WidgetData.time(snapshot.optLong("checkedAt")));
            view.setOnClickPendingIntent(R.id.companion_second,WidgetActions.pending(context,id,warningLine?"task":WidgetRows.action(second,snapshot),true));
            }
            view.setViewVisibility(R.id.companion_timer,firstTimer||secondTimer?View.VISIBLE:View.GONE);
            if(firstTimer||secondTimer) {
                long start=task.optLong("startedAt"), end=task.optLong("completedAt",0); boolean running=end==0&&task.optBoolean("active");
                view.setChronometer(R.id.companion_timer,SystemClock.elapsedRealtime()-Math.max(0,(end>0?end:System.currentTimeMillis())-start),"%s",running);
                view.setContentDescription(R.id.companion_timer,"Elapsed since "+WidgetData.time(start));
                view.setTextColor(R.id.companion_timer,light?ink:Color.rgb(19,245,128));
            }
        }
        view.setOnClickPendingIntent(R.id.companion_timer,WidgetActions.pending(context,id,"task",true));
        for(int i=1;i<=2;i++) {
            String action=settings.optString("action"+i,i==1?"refresh":"settings"); int target=i==1?R.id.companion_action1:R.id.companion_action2;
            view.setImageViewResource(target,icon(action));view.setInt(target,"setColorFilter",tint);
            view.setContentDescription(target,WidgetActions.label(action));view.setOnClickPendingIntent(target,WidgetActions.pending(context,id,action,true));
        }
        return view;
    }
    /**
     * Agent activity second line. Under an activity first line it shows the running workflow (or the
     * previous event); otherwise the latest event. Failed refreshes keep the dated reading and say so.
     */
    private static void activitySecond(Context context,RemoteViews view,JSONObject snapshot,boolean firstActivity,String message,boolean light,int muted,long now,int id) {
        JSONObject event=firstActivity?WidgetRows.nextActivity(snapshot):WidgetRows.latestActivity(snapshot);
        JSONObject activity=snapshot.optJSONObject("activity");
        long checked=activity==null||activity.optLong("checkedAt")<=0?snapshot.optLong("checkedAt"):activity.optLong("checkedAt");
        boolean failedRefresh=!message.isEmpty()&&!"Refreshing…".equals(message);
        String line, description; int colour;
        if(failedRefresh) {
            line=message+" · as of "+WidgetRows.clock(checked);
            description="Warning: "+message+". GitHub activity as of "+WidgetData.time(checked);
            colour=OwnerWidgetProvider.color("yellow",light);
        } else if(event!=null) {
            boolean live=WidgetRows.activityLive(snapshot,now);
            line=WidgetRows.glyph(WidgetRows.activityColor(event))+" "+WidgetRows.activityLine(event,now,live);
            description=WidgetRows.activityWord(event)+": "+WidgetRows.activityLine(event,now,live)+". At "+WidgetData.time(event.optLong("at"))+". GitHub activity checked "+WidgetData.time(checked);
            colour="fail".equals(event.optString("state"))?OwnerWidgetProvider.color("red",light):muted;
        } else {
            boolean available=WidgetRows.activityEvents(snapshot)!=null;
            line=firstActivity&&available?"GitHub activity · checked "+WidgetRows.clock(checked):WidgetRows.activityStatus(snapshot)+(available?"":" · "+WidgetRows.clock(checked));
            description=line+". Workflow runs and pull requests only; the development chat is not shown.";
            colour=available?muted:OwnerWidgetProvider.color("yellow",light);
        }
        view.setTextViewText(R.id.companion_second,line);
        view.setTextColor(R.id.companion_second,colour);
        view.setContentDescription(R.id.companion_second,description);
        view.setOnClickPendingIntent(R.id.companion_second,WidgetActions.pending(context,id,"activity",true));
    }
    static int icon(String action) {
        switch (action == null ? "" : action) {
            case "refresh": return R.drawable.ic_widget_refresh;
            case "logs": return R.drawable.ic_widget_logs;
            case "report": return R.drawable.ic_widget_report;
            case "task": return R.drawable.ic_widget_task;
            case "diagnostics": return R.drawable.ic_widget_diagnostics;
            case "website": return R.drawable.ic_widget_website;
            case "settings": return R.drawable.ic_widget_settings;
            default: return R.drawable.ic_widget_account;
        }
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){ renderAll(context);OwnerWidgetJob.schedule(context); }
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,Bundle options){ renderAll(context); }
    @Override public void onDeleted(Context context,int[] ids){ for(int id:ids)CompanionSettings.remove(context,id); WidgetRefresh.scheduleActivity(context); }
    @Override public void onDisabled(Context context){ WidgetRefresh.cancelActivity(context); if(OwnerWidgetProvider.ids(context).length==0){OwnerWidgetJob.cancel(context);WidgetStore.clear(context,null);} }
}
