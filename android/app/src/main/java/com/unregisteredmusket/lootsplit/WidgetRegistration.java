package com.unregisteredmusket.lootsplit;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

/** Reannounce existing providers after an APK upgrade without disabling/removing widgets. */
final class WidgetRegistration {
    private static final String PREFERENCES = "widget-registration";
    static synchronized boolean refresh(Context context, boolean force) {
        try { return refreshInternal(context,force); }
        catch(RuntimeException e){return false;} // A launcher/service failure must not stop the app opening.
    }
    private static boolean refreshInternal(Context context, boolean force) {
        String version;
        try { version=context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName; }
        catch(PackageManager.NameNotFoundException e){return false;}
        android.content.SharedPreferences preferences=context.getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE);
        if(!force && version.equals(preferences.getString("announced-version","")))return true;
        boolean success=true;
        for(Class<?> type:new Class<?>[]{OwnerWidgetProvider.class,CompanionWidgetProvider.class}) {
            ComponentName component=new ComponentName(context,type);
            PackageManager packages=context.getPackageManager();
            int enabled=packages.getComponentEnabledSetting(component);
            // A one-time explicit enable also issues PACKAGE_CHANGED on older Android releases.
            // Never disable/re-enable a provider: doing so destroys placed widget instances.
            if(enabled==PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)
                packages.setComponentEnabledSetting(component,PackageManager.COMPONENT_ENABLED_STATE_ENABLED,PackageManager.DONT_KILL_APP);
            if(enabled!=PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && enabled!=PackageManager.COMPONENT_ENABLED_STATE_ENABLED)continue;
            if(Build.VERSION.SDK_INT>=28) {
                try {
                    AppWidgetManager manager=AppWidgetManager.getInstance(context);
                    // Reset any retained alternate metadata, then explicitly reload the manifest entry.
                    // This tells listening launchers their provider list changed; IDs/settings survive.
                    manager.updateAppWidgetProviderInfo(component,null);
                    manager.updateAppWidgetProviderInfo(component,AppWidgetManager.META_DATA_APPWIDGET_PROVIDER);
                }catch(IllegalArgumentException|IllegalStateException e){success=false;}
            }
        }
        if(success)preferences.edit().putString("announced-version",version).apply();
        return success;
    }
    static boolean available(Context context,Class<?> type) {
        ComponentName component=new ComponentName(context,type);
        for(AppWidgetProviderInfo info:AppWidgetManager.getInstance(context).getInstalledProviders())
            if(component.equals(info.provider))return true;
        return false;
    }
}
