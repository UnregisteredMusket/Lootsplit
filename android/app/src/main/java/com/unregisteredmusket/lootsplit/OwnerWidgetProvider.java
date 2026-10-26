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
    /** A tap on a log row: toggles the row named by ROW_ID, or opens WidgetActions.DESTINATION. */
    static final String ROW_TAP = "com.unregisteredmusket.lootsplit.WIDGET_ROW_TAP";
    static final String ROW_ID = "lootsplit_widget_row";

    static int[] ids(Context context) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, OwnerWidgetProvider.class));
    }
    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : ids(context)) render(context, manager, id, null);
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
    /** Layout breakpoints (dp): below LARGE_MIN_HEIGHT the 4×2 face; below TILES_MIN_HEIGHT it drops its tiles. */
    static final int LARGE_MIN_HEIGHT = 260, TILES_MIN_HEIGHT = 150;
    static void render(Context context, AppWidgetManager manager, int id, Bundle options) {
        JSONObject state = WidgetStore.read(context);
        if (Build.VERSION.SDK_INT >= 31) {
            // The launcher picks the largest layout that fits each placement (and re-picks on resize).
            java.util.Map<SizeF, RemoteViews> sized = new java.util.HashMap<>();
            sized.put(new SizeF(250f, 110f), medium(context, state, id, false));
            sized.put(new SizeF(250f, TILES_MIN_HEIGHT), medium(context, state, id, true));
            sized.put(new SizeF(250f, LARGE_MIN_HEIGHT), views(context, state, true, id));
            manager.updateAppWidget(id, new RemoteViews(sized));
            return;
        }
        if (options == null) options = manager.getAppWidgetOptions(id);
        // Portrait height is the maximum height; 0 (unknown) keeps the full 4×4 face.
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        manager.updateAppWidget(id, height > 0 && height < LARGE_MIN_HEIGHT ? medium(context, state, id, height >= TILES_MIN_HEIGHT) : views(context, state, true, id));
    }
    static RemoteViews views(Context context, JSONObject state, boolean expanded) { return views(context,state,expanded,-1); }
    /** Theme colours shared by the faces. */
    private static WidgetCharts.Palette palette(Context context, int id) { return WidgetCharts.Palette.of(WidgetAppearance.light(context, id)); }
    /**
     * Header and status shared by the 4×4 and 4×2 faces: reading time, glyph box, status word,
     * "since 10:41 · active 31m" (or "21 checks passed") and the ✕ ! i severity counts.
     */
    /**
     * True at a system font scale above the default (Android's "Large" is 1.15, "Largest" 1.3). The
     * faces then drop their least important lines (the 4×2 "since" line and pace note) rather than
     * shrink text or clip it (design plan M5); the spoken descriptions keep that text.
     */
    static boolean largeFont(Context context) { return context.getResources().getConfiguration().fontScale > 1.05f; }
    /** Severity names for the count chips, in chip order; "diagnostics-<severity>" opens Diagnostics showing only that severity. */
    static final String[] SEVERITIES = {"critical", "warning", "info"};
    private static void status(Context context, RemoteViews view, JSONObject state, JSONObject snapshot, int id, WidgetCharts.Palette p, boolean showSince) {
        boolean light = p.light;
        boolean connected=!state.optString("token").isEmpty()||state.optBoolean(WidgetStore.UNAVAILABLE); String message=state.optString("message");
        boolean refreshing=connected&&"Refreshing…".equals(message);
        String status=statusColor(snapshot);
        view.setTextColor(R.id.monitor_title, light ? p.ink : p.ok);
        view.setTextColor(R.id.monitor_checked, p.muted);
        view.setTextViewText(R.id.monitor_checked,snapshot==null?"—":WidgetRows.clock(snapshot.optLong("checkedAt")));
        view.setContentDescription(R.id.monitor_checked,snapshot==null?"No current reading":(message.isEmpty()?"Checked ":"Last reading ")+WidgetData.time(snapshot.optLong("checkedAt"))+" · #"+snapshot.optLong("snapshotId"));
        boolean signedOut=snapshot==null&&!connected;
        glyph(view,R.id.monitor_glyph,signedOut?"":status,light,false);
        String word=refreshing?"REFRESHING":snapshot==null?(connected?"AWAITING CHECK":"SIGN IN REQUIRED"):message.isEmpty()?WidgetRows.status(snapshot):"LAST KNOWN STATUS";
        view.setTextViewText(R.id.monitor_health,word);
        view.setTextColor(R.id.monitor_health,color(status,light));
        int[] counts=WidgetRows.counts(snapshot);
        String since=since(snapshot);
        view.setViewVisibility(R.id.monitor_since,since.isEmpty()||!showSince?View.GONE:View.VISIBLE);
        view.setTextViewText(R.id.monitor_since,since);
        view.setTextColor(R.id.monitor_since,p.muted);
        view.setContentDescription(R.id.monitor_health,word+(since.isEmpty()?"":", "+since)+(snapshot==null?"":". "+counts[0]+" critical, "+counts[1]+" warning, "+counts[2]+" info"));
        int[] ids={R.id.monitor_count_crit,R.id.monitor_count_warn,R.id.monitor_count_info};
        String[] glyphs={"✕","!","i"}; int[] tones={p.crit,p.warn,p.info};
        view.setViewVisibility(R.id.monitor_counts,snapshot==null?View.GONE:View.VISIBLE);
        for(int i=0;i<3;i++){
            view.setTextViewText(ids[i],glyphs[i]+counts[i]);
            // A zero count is dimmed (blended toward the background); the number still reads 0.
            view.setTextColor(ids[i],counts[i]>0?tones[i]:blend(tones[i],p.background,0.55f));
            view.setContentDescription(ids[i],counts[i]+(i==0?" critical":i==1?" warning":" info")+". Opens diagnostics showing "+SEVERITIES[i]+" items");
            // Each count opens Diagnostics filtered to its severity (the chips are hidden without a reading).
            if(snapshot!=null) view.setOnClickPendingIntent(ids[i],WidgetActions.pending(context,id,"diagnostics-"+SEVERITIES[i],false));
        }
        // The whole status block opens Diagnostics (My account when signed out); › shows that it is a link.
        view.setTextColor(R.id.monitor_status_more,p.muted);
        view.setOnClickPendingIntent(R.id.monitor_status,WidgetActions.pending(context,id,snapshot==null?"account":"diagnostics",false));
        view.setOnClickPendingIntent(R.id.monitor_refresh,WidgetActions.pending(context,id,"refresh",false));
    }
    static int blend(int a,int b,float t){ return Color.rgb(Math.round(Color.red(a)*(1-t)+Color.red(b)*t),Math.round(Color.green(a)*(1-t)+Color.green(b)*t),Math.round(Color.blue(a)*(1-t)+Color.blue(b)*t)); }
    /** "since 10:41 · active 31m" for the worst active item, "21 checks passed" when clear, "" without a reading. */
    static String since(JSONObject snapshot) {
        if (snapshot == null) return "";
        long started = 0, checked = snapshot.optLong("checkedAt");
        int worst = 3;
        for (JSONObject item : WidgetRows.attentionItems(snapshot)) {
            int rank = WidgetRows.rank(item.optString("severity"));
            if (rank > 1) continue;
            long at = item.optLong("startedAt", 0);
            if (rank < worst) { worst = rank; started = at; }
            else if (rank == worst && at > 0 && (started == 0 || at < started)) started = at;
        }
        if (worst <= 1) return started > 0 ? "since " + WidgetRows.clock(started) + " · active " + WidgetRows.duration(checked - started) : "";
        org.json.JSONArray diagnostics = snapshot.optJSONArray("diagnostics");
        int passed = 0; if (diagnostics != null) for (int i = 0; i < diagnostics.length(); i++) { JSONObject d = diagnostics.optJSONObject(i); if (d != null && "green".equals(d.optString("color"))) passed++; }
        return passed > 0 && "green".equals(statusColor(snapshot)) ? passed + (passed == 1 ? " check passed" : " checks passed") : "";
    }
    static RemoteViews views(Context context, JSONObject state, boolean expanded, int id) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.owner_widget);
        WidgetCharts.Palette p=palette(context,id); boolean light=p.light;
        int text=p.ink, muted=p.muted, accent=light?p.ink:p.ok;
        JSONObject snapshot=current(state);
        boolean connected=!state.optString("token").isEmpty()||state.optBoolean(WidgetStore.UNAVAILABLE); String message=state.optString("message");
        String status=statusColor(snapshot); boolean failure=snapshot!=null&&"red".equals(status);
        // Root: the existing opaque theme fill; a confirmed failure swaps in the red-bordered variant.
        if(failure) view.setInt(R.id.monitor_root,"setBackgroundResource",light?R.drawable.monitor_background_alert_light:R.drawable.monitor_background_alert);
        else view.setInt(R.id.monitor_root,"setBackgroundColor",p.background);
        for(int target: new int[]{R.id.monitor_open,R.id.monitor_refresh}) view.setTextColor(target,accent);
        view.setTextColor(R.id.monitor_identity,muted);
        status(context,view,state,snapshot,id,p,true);

        // Reason line (the full list stays in its spoken description and in the items).
        String[] reason=WidgetRows.reason(snapshot);
        view.setTextViewText(R.id.monitor_services,!message.isEmpty()?message:snapshot==null?(connected?"No current reading · tap Refresh":"Tap Sign in to connect your owner account"):reason[0]);
        view.setContentDescription(R.id.monitor_services,!message.isEmpty()?message:snapshot==null?"No current reading":reason[1]);
        view.setTextColor(R.id.monitor_services,failure&&!light?text:muted);

        // The list. Expanded rows and tiles are kept by ID across readings; IDs no longer present are pruned.
        java.util.Set<String> expandedRows=WidgetRowState.prune(context,id,WidgetRows.rows(snapshot,WidgetRowState.expanded(context,id)));
        org.json.JSONArray rows=WidgetRows.rows(snapshot,expandedRows);
        if(Build.VERSION.SDK_INT>=31) {
            RemoteViews.RemoteCollectionItems.Builder items=new RemoteViews.RemoteCollectionItems.Builder().setViewTypeCount(OwnerWidgetService.VIEW_TYPES).setHasStableIds(false);
            for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);items.addItem(i,OwnerWidgetService.rowView(context,row,id,expandedRows));}
            view.setRemoteAdapter(R.id.monitor_list,items.build());
        } else {
            Intent service=new Intent(context,OwnerWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).putExtra("generation",state.optString("generation"));
            service.setData(android.net.Uri.parse("lootsplit-widget://collection/"+id+"/"+state.optString("generation","empty")));
            view.setRemoteAdapter(R.id.monitor_list,service);
        }
        // Row taps are a broadcast to this provider: a row's fill-in names the row (or tile, or range)
        // to change, a button's fill-in names the app destination (opened in onReceive).
        Intent template=new Intent(context,OwnerWidgetProvider.class).setAction(ROW_TAP).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(android.net.Uri.parse("lootsplit-widget://collection-row/"+id)).addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        view.setPendingIntentTemplate(R.id.monitor_list,PendingIntent.getBroadcast(context,230000+Math.max(0,id),template,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0)));

        // Footer: identity (no email on the face), LOGS and REFRESH.
        view.setTextViewText(R.id.monitor_identity,snapshot==null?"OWNER · SIGN IN":"OWNER · "+snapshot.optString("name")+" · #"+snapshot.optLong("snapshotId"));
        view.setContentDescription(R.id.monitor_account,snapshot==null?"Owner access. Sign in in My account":"Owner access, "+snapshot.optString("name")+". Open My account");
        view.setOnClickPendingIntent(R.id.monitor_account,WidgetActions.pending(context,id,"account",false));
        view.setTextViewText(R.id.monitor_open,connected?"LOGS":"SIGN IN");
        view.setContentDescription(R.id.monitor_open,connected?"Open logs and reports":"Sign in");
        view.setOnClickPendingIntent(R.id.monitor_open,WidgetActions.pending(context,id,connected?"logs":"account",false));
        return view;
    }
    /**
     * The 4×2 face: header with refresh, status, one line (the most severe active item, else the
     * latest recovery) and three mini tiles: requests with errors on their own baseline, the
     * fullest plan-usage gauge with its pace line, and the last five main runs.
     */
    static RemoteViews medium(Context context, JSONObject state, int id, boolean tiles) {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.owner_widget_medium);
        WidgetCharts.Palette p=palette(context,id); boolean light=p.light;
        JSONObject snapshot=current(state);
        boolean connected=!state.optString("token").isEmpty()||state.optBoolean(WidgetStore.UNAVAILABLE); String message=state.optString("message");
        boolean failure=snapshot!=null&&"red".equals(statusColor(snapshot));
        if(failure) view.setInt(R.id.monitor_root,"setBackgroundResource",light?R.drawable.monitor_background_alert_light:R.drawable.monitor_background_alert);
        else view.setInt(R.id.monitor_root,"setBackgroundColor",p.background);
        view.setTextColor(R.id.monitor_refresh,light?p.ink:p.ok);
        boolean large=largeFont(context);
        status(context,view,state,snapshot,id,p,!large);
        int tileBackground=light?R.drawable.item_tile_light:R.drawable.item_tile_dark;
        view.setInt(R.id.medium_item,"setBackgroundResource",tileBackground);
        // One line: the worst active item, the latest recovery, or the sign-in/refresh state.
        java.util.List<JSONObject> items=WidgetRows.attentionItems(snapshot);
        JSONObject top=null; for(JSONObject item:items) if(!"info".equals(item.optString("severity"))){top=item;break;}
        String chip="",line; int tone=p.muted;
        if(snapshot==null){line=!message.isEmpty()?message:connected?"No current reading · tap ↻":"Sign in to connect your owner account";}
        else if(top!=null){chip=WidgetRows.chip(top.optString("severity"));tone=p.severity(top.optString("severity"));line=top.optString("title")+" · "+top.optString("meta");}
        else {
            JSONObject resolved=snapshot.optJSONObject("resolved");org.json.JSONArray list=resolved==null?null:resolved.optJSONArray("items");
            JSONObject latest=list==null?null:list.optJSONObject(0);
            if(latest!=null){chip="✓";tone=p.ok;line=latest.optString("component")+" · resolved "+WidgetRows.clock(latest.optLong("resolvedAt"))+(latest.optLong("startedAt")>0?" · lasted "+WidgetRows.duration(latest.optLong("resolvedAt")-latest.optLong("startedAt")):"");}
            else line=resolved==null?"No active problems":"absent".equals(resolved.optString("state"))?"No active problems · recovery times need a server update":"ready".equals(resolved.optString("state"))?"No active problems · none resolved in 24h":"No active problems";
        }
        view.setViewVisibility(R.id.medium_item_chip,chip.isEmpty()?View.GONE:View.VISIBLE);
        view.setTextViewText(R.id.medium_item_chip,chip);view.setTextColor(R.id.medium_item_chip,tone);
        view.setTextViewText(R.id.medium_item_text,line);view.setTextColor(R.id.medium_item_text,p.ink);
        view.setContentDescription(R.id.medium_item,(top!=null?WidgetRows.severityWord(top.optString("severity"))+": ":"")+line+". Open diagnostics");
        view.setOnClickPendingIntent(R.id.medium_item,WidgetActions.pending(context,id,snapshot==null?"account":"diagnostics",false));
        view.setViewVisibility(R.id.medium_tiles,tiles?View.VISIBLE:View.GONE);
        if(!tiles) return view;
        float density=context.getResources().getDisplayMetrics().density;
        for(int tile:new int[]{R.id.medium_tile_req,R.id.medium_tile_usage,R.id.medium_tile_main}) view.setInt(tile,"setBackgroundResource",tileBackground);
        for(int key:new int[]{R.id.medium_req_key,R.id.medium_usage_key,R.id.medium_main_key}) view.setTextColor(key,p.faint);
        for(int note:new int[]{R.id.medium_req_note,R.id.medium_usage_note,R.id.medium_main_note}) view.setTextColor(note,p.muted);
        for(int value:new int[]{R.id.medium_req_value,R.id.medium_usage_value}) view.setTextColor(value,p.ink);
        // Requests 24h.
        long[] traffic=WidgetRows.traffic(snapshot);
        String errorsState=snapshot==null?"":snapshot.optString("errorsState");
        android.text.SpannableStringBuilder req=new android.text.SpannableStringBuilder(traffic==null?"—":WidgetRows.compact(traffic[0]));
        if(traffic!=null){req.append(" ");int s=req.length();req.append(WidgetRows.compact(traffic[1])).append(" err");req.setSpan(new android.text.style.ForegroundColorSpan(traffic[1]==0?p.muted:"warning".equals(errorsState)?p.warn:p.crit),s,req.length(),android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);}
        view.setTextViewText(R.id.medium_req_value,req);
        JSONObject series=snapshot==null?null:snapshot.optJSONObject("series");
        boolean chart=series!=null&&"ready".equals(series.optString("state"));
        view.setViewVisibility(R.id.medium_req_chart,chart?View.VISIBLE:View.GONE);
        if(chart) view.setImageViewBitmap(R.id.medium_req_chart,WidgetCharts.sparkline(longs(series.optJSONArray("requests")),longs(series.optJSONArray("errors")),104,26,density,p));
        view.setTextViewText(R.id.medium_req_note,chart?"":snapshot==null?"":series==null?"chart after refresh":"absent".equals(series.optString("state"))?"chart: server update":"chart unavailable");
        view.setViewVisibility(R.id.medium_req_note,chart?View.GONE:View.VISIBLE);
        view.setContentDescription(R.id.medium_tile_req,"Requests in the past 24 hours: "+(traffic==null?"unavailable":traffic[0]+", errors "+traffic[1])+(chart?". Chart per half-hour with errors on their own baseline":""));
        view.setOnClickPendingIntent(R.id.medium_tile_req,WidgetActions.pending(context,id,"logs",false));
        // Fullest plan-usage gauge (amber at 80% or more; gauge only).
        JSONObject usage=snapshot==null?null:snapshot.optJSONObject("usage");
        org.json.JSONArray gauges=usage==null||!"ready".equals(usage.optString("state"))?null:usage.optJSONArray("gauges");
        JSONObject worst=null;
        if(gauges!=null)for(int i=0;i<gauges.length();i++){JSONObject g=gauges.optJSONObject(i);if(g!=null&&g.opt("percent") instanceof Number&&(worst==null||g.optDouble("percent")>worst.optDouble("percent")))worst=g;}
        boolean hot=worst!=null&&worst.optBoolean("hot");
        android.text.SpannableStringBuilder use=new android.text.SpannableStringBuilder(worst==null?"—":worst.optString("text"));
        use.setSpan(new android.text.style.ForegroundColorSpan(hot?p.warn:p.ink),0,use.length(),android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if(worst!=null){use.append(" ");int s=use.length();use.append(worst.optString("label"));use.setSpan(new android.text.style.ForegroundColorSpan(p.muted),s,use.length(),android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);}
        view.setTextViewText(R.id.medium_usage_value,use);
        int value=worst==null?0:(int)Math.round(Math.min(100,Math.max(0,worst.optDouble("percent"))));
        view.setViewVisibility(R.id.medium_usage_bar,worst!=null&&!hot?View.VISIBLE:View.INVISIBLE);
        view.setViewVisibility(R.id.medium_usage_hot,hot?View.VISIBLE:View.GONE);
        view.setProgressBar(R.id.medium_usage_bar,100,value,false);view.setProgressBar(R.id.medium_usage_hot,100,value,false);
        double elapsed=usage==null?-1:usage.optDouble("elapsed",-1);
        android.graphics.Bitmap pace=worst==null?null:WidgetCharts.paceStrip(elapsed);
        view.setViewVisibility(R.id.medium_usage_pace,pace==null?View.GONE:View.VISIBLE);
        if(pace!=null){view.setImageViewBitmap(R.id.medium_usage_pace,pace);view.setInt(R.id.medium_usage_pace,"setColorFilter",p.ink);}
        // At a large font scale the pace note gives way (the pace line and the description keep it); a gap note stays.
        view.setTextViewText(R.id.medium_usage_note,worst==null?(usage==null?"":"unavailable"):elapsed>=0&&!large?"pace "+WidgetData.percent(elapsed):"");
        view.setViewVisibility(R.id.medium_usage_note,worst!=null&&(elapsed<0||large)?View.GONE:View.VISIBLE);
        view.setContentDescription(R.id.medium_tile_usage,worst==null?"Cloudflare plan usage unavailable":"Highest plan usage this cycle: "+worst.optString("label")+" "+worst.optString("text")+(hot?", 80% or more":"")+(elapsed>=0?". Cycle elapsed "+WidgetData.percent(elapsed):""));
        view.setOnClickPendingIntent(R.id.medium_tile_usage,WidgetActions.pending(context,id,"logs",false));
        // Last five main runs.
        org.json.JSONArray runs=snapshot==null?null:snapshot.optJSONArray("mainRuns");
        JSONObject activity=snapshot==null?null:snapshot.optJSONObject("activity");
        int running=activity!=null&&"ready".equals(activity.optString("state"))?activity.optInt("active"):0;
        org.json.JSONArray states=new org.json.JSONArray();
        if(runs!=null){for(int i=Math.min(runs.length(),5)-1;i>=0;i--)states.put(runs.optJSONObject(i)==null?"":runs.optJSONObject(i).optString("conclusion"));if(running>0)states.put("running");}
        view.setTextViewText(R.id.medium_main_pips,runs==null?"—":WidgetTiles.pips(states,p));
        view.setTextViewText(R.id.medium_main_note,runs==null?(snapshot==null?"":series==null?"after refresh":"absent".equals(series.optString("state"))?"server update":"GitHub unavailable"):running>0?running+" running":"live "+snapshot.optString("commit"));
        view.setContentDescription(R.id.medium_tile_main,runs==null?"Main runs unavailable":"Last "+Math.min(runs.length(),5)+" completed main runs"+(running>0?", "+running+" running":"")+". Open development activity");
        view.setOnClickPendingIntent(R.id.medium_tile_main,WidgetActions.pending(context,id,"activity",false));
        return view;
    }
    static Long[] longs(org.json.JSONArray values) {
        if (values == null) return null;
        Long[] out = new Long[values.length()];
        for (int i = 0; i < values.length(); i++) { Object v = values.opt(i); out[i] = v instanceof Number ? ((Number) v).longValue() : null; }
        return out;
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
        } else if (ROW_TAP.equals(intent.getAction())) {
            rowTap(context, intent);
        } else if (WidgetRefresh.ACTIVITY_TICK.equals(intent.getAction())) {
            // Background (not manual) check: the same coalescing, deadline and account checks apply.
            PendingResult pending = goAsync();
            if (!WidgetRefresh.activityTick(context, error -> pending.finish())) pending.finish();
        }
    }
    /**
     * Expand/collapse: flip the row's saved state, re-render that instance (API 31+ carries the rows
     * in the RemoteViews) and notify the collection (API 24–30 RemoteViewsService reloads its rows).
     * OPEN on an expanded row starts the same in-app destination the row used to open directly.
     */
    static void rowTap(Context context, Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
        String destination = intent.getStringExtra(WidgetActions.DESTINATION), row = intent.getStringExtra(ROW_ID);
        if (destination != null) { openRow(context, id, WidgetActions.rowAction(destination)); return; }
        if (row == null || row.isEmpty()) return;
        // The Traffic tile's 24h/7d segments set a range; everything else toggles. No fetch either way.
        if (row.startsWith(WidgetRowState.RANGE)) WidgetRowState.setRange(context, id, row);
        else WidgetRowState.toggle(context, id, row);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        render(context, manager, id, null);
        manager.notifyAppWidgetViewDataChanged(id, R.id.monitor_list);
    }
    private static void openRow(Context context, int id, String action) {
        PendingIntent open = WidgetActions.pending(context, id, action, false);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                // Pass on the launcher tap's permission to start the activity (Android 14+ sender opt-in).
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic()
                    .setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                open.send(context, 0, null, null, null, null, options.toBundle());
            } else open.send();
        } catch (PendingIntent.CanceledException ignored) { }
    }
    @Override public void onDeleted(Context context,int[] ids){ for(int id:ids){CompanionSettings.remove(context,id);WidgetRowState.remove(context,id);} }
    @Override public void onDisabled(Context context) {
        if (CompanionWidgetProvider.ids(context).length == 0) {
            OwnerWidgetJob.cancel(context);
            WidgetRefresh.cancelActivity(context);
            WidgetStore.clear(context, null);
        }
    }
}
