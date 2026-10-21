package com.unregisteredmusket.lootsplit;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(OwnerWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        // PackageManager/AppWidgetManager work and renderAll stay off the UI thread.
        // refresh is synchronized and catches its own failures; use the application context.
        final android.content.Context appContext = getApplicationContext();
        new Thread(() -> WidgetRegistration.refresh(appContext,false), "lootsplit-widget-registration").start();
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra(OwnerWidgetProvider.OPEN, false) && bridge != null)
            bridge.triggerWindowJSEvent("lootsplit-open-owner-widget");
    }
}
