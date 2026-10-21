package com.unregisteredmusket.lootsplit;
/** Disposable framework-host surface, packaged only in debug verification builds. */
public class WidgetAuditActivity extends android.app.Activity {
    volatile int configurationResult = Integer.MIN_VALUE;
    volatile int configuredWidget = android.appwidget.AppWidgetManager.INVALID_APPWIDGET_ID;
    @Override protected void onActivityResult(int request, int result, android.content.Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 901) {
            configurationResult = result;
            configuredWidget = data == null ? android.appwidget.AppWidgetManager.INVALID_APPWIDGET_ID
                : data.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, android.appwidget.AppWidgetManager.INVALID_APPWIDGET_ID);
        }
    }
}
