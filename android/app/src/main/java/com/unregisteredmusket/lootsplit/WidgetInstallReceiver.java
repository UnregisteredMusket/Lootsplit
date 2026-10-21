package com.unregisteredmusket.lootsplit;

/** System-only upgrade signal; no sign-in, network request or account-screen visit is needed. */
public class WidgetInstallReceiver extends android.content.BroadcastReceiver {
    @Override public void onReceive(android.content.Context context,android.content.Intent intent) {
        if(android.content.Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            CompanionSettings.preserveLegacyDefaults(context); // Before any render: keep earlier unsaved companions on Development.
            WidgetRegistration.refresh(context,true); // Also renders every placed widget.
            OwnerWidgetJob.schedule(context);
        }
    }
}
