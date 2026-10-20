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
    static void renderAll(Context context) { for(int id:ids(context)) AppWidgetManager.getInstance(context).updateAppWidget(id,views(context,WidgetStore.read(context),CompanionSettings.read(context,id),id)); }
    static RemoteViews views(Context context, JSONObject state, JSONObject settings, int id) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.companion_widget);
        JSONObject snapshot=OwnerWidgetProvider.current(state), task=snapshot==null?null:snapshot.optJSONObject("task");
        String theme=settings.optString("theme","terminal"); boolean light="light".equals(theme)||"system".equals(theme)&&(context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)!=android.content.res.Configuration.UI_MODE_NIGHT_YES;
        int ink=light?Color.rgb(32,53,46):Color.rgb(230,248,236);
        view.setInt(R.id.companion_root,"setBackgroundColor",light?Color.rgb(247,242,228):Color.rgb(7,23,18));
        view.setTextColor(R.id.companion_identity,ink); view.setTextColor(R.id.companion_first,ink); view.setTextColor(R.id.companion_second,ink); view.setTextColor(R.id.companion_timer,ink); view.setTextColor(R.id.companion_age,ink);
        view.setTextViewText(R.id.companion_identity,snapshot==null?"OWNER · SIGN IN":"OWNER · "+snapshot.optString("name"));
        view.setOnClickPendingIntent(R.id.companion_identity,WidgetActions.pending(context,id,"account",true));
        view.setTextViewText(R.id.companion_light,OwnerWidgetProvider.statusColor(snapshot).equals("red")?"!":OwnerWidgetProvider.statusColor(snapshot).equals("green")?"✓":"?");
        view.setTextColor(R.id.companion_light,OwnerWidgetProvider.color(OwnerWidgetProvider.statusColor(snapshot)));
        view.setContentDescription(R.id.companion_light,OwnerWidgetProvider.statusColor(snapshot)+" status; open diagnostics for the reason");
        view.setOnClickPendingIntent(R.id.companion_light,WidgetActions.pending(context,id,"diagnostics",true));
        String first=settings.optString("first","task"),second=settings.optString("second","timer");
        view.setTextViewText(R.id.companion_first,WidgetRows.category(snapshot,first)); view.setTextViewText(R.id.companion_second,WidgetRows.category(snapshot,second));
        view.setOnClickPendingIntent(R.id.companion_first,WidgetActions.pending(context,id,WidgetRows.action(first),true)); view.setOnClickPendingIntent(R.id.companion_second,WidgetActions.pending(context,id,WidgetRows.action(second),true));
        boolean timer="timer".equals(second)&&task!=null;
        boolean firstTimer="timer".equals(first)&&task!=null;
        view.setViewVisibility(R.id.companion_timer_first,firstTimer?View.VISIBLE:View.GONE); view.setViewVisibility(R.id.companion_first,firstTimer?View.GONE:View.VISIBLE);
        view.setViewVisibility(R.id.companion_timer,timer?View.VISIBLE:View.GONE); view.setViewVisibility(R.id.companion_second,timer?View.GONE:View.VISIBLE);
        if(timer) { long start=task.optLong("startedAt"), end=task.optLong("completedAt",0); boolean running=end==0&&task.optBoolean("active"); view.setChronometer(R.id.companion_timer,SystemClock.elapsedRealtime()-Math.max(0,(end>0?end:System.currentTimeMillis())-start),"Elapsed %s",running); }
        if(firstTimer) { long start=task.optLong("startedAt"), end=task.optLong("completedAt",0); boolean running=end==0&&task.optBoolean("active"); view.setChronometer(R.id.companion_timer_first,SystemClock.elapsedRealtime()-Math.max(0,(end>0?end:System.currentTimeMillis())-start),"Elapsed %s",running); }
        view.setTextColor(R.id.companion_timer_first,ink);
        view.setOnClickPendingIntent(R.id.companion_timer_first,WidgetActions.pending(context,id,"task",true));
        view.setOnClickPendingIntent(R.id.companion_timer,WidgetActions.pending(context,id,"task",true));
        view.setTextViewText(R.id.companion_age,snapshot==null?state.optString("message","Connect in My account"):"As of "+WidgetData.time(snapshot.optLong("checkedAt")));
        for(int i=1;i<=2;i++) { String action=settings.optString("action"+i,i==1?"refresh":"settings"); int target=i==1?R.id.companion_action1:R.id.companion_action2; view.setTextViewText(target,WidgetActions.label(action));view.setTextColor(target,ink);view.setContentDescription(target,WidgetActions.label(action));view.setOnClickPendingIntent(target,WidgetActions.pending(context,id,action,true)); }
        return view;
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){ renderAll(context);OwnerWidgetJob.schedule(context); }
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,Bundle options){ renderAll(context); }
    @Override public void onDeleted(Context context,int[] ids){ for(int id:ids)CompanionSettings.remove(context,id); }
    @Override public void onDisabled(Context context){ if(OwnerWidgetProvider.ids(context).length==0){OwnerWidgetJob.cancel(context);WidgetStore.clear(context,null);} }
}
