package com.unregisteredmusket.lootsplit;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** System-only upgrade signal; no sign-in, network request or account-screen visit is needed. */
public class WidgetInstallReceiver extends android.content.BroadcastReceiver {
    // PackageManager/AppWidgetManager work and renderAll stay off the broadcast's main thread,
    // as MainActivity does; goAsync keeps the process alive until the work finishes.
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    @Override public void onReceive(android.content.Context context,android.content.Intent intent) {
        if(!android.content.Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        final android.content.Context app = context.getApplicationContext();
        final PendingResult pending = goAsync(); // null only when called outside a system broadcast
        WORK.execute(() -> {
            try {
                CompanionSettings.preserveLegacyDefaults(app); // Before any render: keep earlier unsaved companions on Development.
                WidgetRegistration.refresh(app,true); // Also renders every placed widget.
                OwnerWidgetJob.schedule(app);
            } catch (RuntimeException ignored) {
                // The next app launch or widget update retries registration; never crash the upgrade.
            } finally { if (pending != null) pending.finish(); }
        });
    }
}
