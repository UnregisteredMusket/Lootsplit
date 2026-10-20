package com.unregisteredmusket.lootsplit;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Automatic checks remain battery-aware; user taps bypass this deferred scheduler. */
public class OwnerWidgetJob extends JobService {
    static final int ID = 197401;
    private WidgetRefresh.Task work;
    private volatile boolean stopped;

    static void schedule(Context context) {
        if (WidgetStore.read(context).optString("token").isEmpty()) return;
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler.getPendingJob(ID) == null) scheduler.schedule(new JobInfo.Builder(ID,
            new ComponentName(context, OwnerWidgetJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).build());
    }
    static void cancel(Context context) { context.getSystemService(JobScheduler.class).cancel(ID); }
    @Override public boolean onStartJob(JobParameters params) {
        stopped = false;
        work = WidgetRefresh.request(getApplicationContext(), false, error -> {
            if (!stopped) jobFinished(params, false);
        });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {
        stopped = true;
        WidgetRefresh.cancelBackground(work);
        return !WidgetStore.read(this).optString("token").isEmpty();
    }
}
