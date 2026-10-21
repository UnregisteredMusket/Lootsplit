package com.unregisteredmusket.lootsplit;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

final class WidgetActions {
    static final String DESTINATION = "lootsplit_monitor_destination";
    static final String[] ACTIONS = {"refresh", "logs", "report", "task", "diagnostics", "website", "account", "settings"};
    static final String[] LABELS = {"Refresh", "Logs", "Report", "Task", "Diagnostics", "Website", "Account", "Settings"};
    static String destination(String value) {
        if (value == null) return "home-screen-widget";
        switch (value) {
            case "logs": return "monitor-history";
            case "report": return "monitor-reports";
            case "task": return "monitor-task";
            case "diagnostics": return "monitor-diagnostics";
            // Agent activity: My account → Field monitor → Development & deployments (GitHub events).
            case "activity": return "field-development";
            case "account": return "account-sign-in";
            default: return "home-screen-widget";
        }
    }
    static String label(String action) { for (int i=0;i<ACTIONS.length;i++) if (ACTIONS[i].equals(action)) return LABELS[i]; return "Account"; }
    static PendingIntent pending(Context context, int id, String action, boolean companion) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        int code = 220000 + Math.abs((id + ":" + action).hashCode() % 10000000);
        Uri identity = Uri.parse("lootsplit-widget://action/" + id + "/" + action);
        if ("refresh".equals(action)) return PendingIntent.getBroadcast(context, code,
            new Intent(context, OwnerWidgetProvider.class).setAction(OwnerWidgetProvider.REFRESH).setData(identity).addFlags(Intent.FLAG_RECEIVER_FOREGROUND), flags);
        if ("settings".equals(action) && companion) return PendingIntent.getActivity(context, code,
            new Intent(context, CompanionWidgetConfigureActivity.class).setData(identity).putExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, id), flags);
        if ("website".equals(action)) return PendingIntent.getActivity(context, code,
            new Intent(Intent.ACTION_VIEW, Uri.parse("https://lootsplit.oliverstorie2017.workers.dev")), flags);
        return PendingIntent.getActivity(context, code, new Intent(context, MainActivity.class).setData(identity)
            .putExtra(OwnerWidgetProvider.OPEN, true).putExtra(DESTINATION, action)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
    }
}
