package com.unregisteredmusket.lootsplit;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Network work stays out of the broadcast receiver; Android controls background timing. */
public class OwnerWidgetJob extends JobService {
    static final int ID = 197401;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Future<?> work;

    static void schedule(Context context) {
        if (WidgetStore.read(context).optString("token").isEmpty()) return;
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler.getPendingJob(ID) == null) scheduler.schedule(new JobInfo.Builder(ID,
            new ComponentName(context, OwnerWidgetJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).build());
    }
    static void cancel(Context context) { context.getSystemService(JobScheduler.class).cancel(ID); }
    @Override public boolean onStartJob(JobParameters params) {
        work = executor.submit(() -> {
            WidgetClient.refresh(getApplicationContext());
            if (!Thread.currentThread().isInterrupted()) jobFinished(params, false);
        });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        if (work != null) work.cancel(true);
        return !WidgetStore.read(this).optString("token").isEmpty();
    }
    @Override public void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
