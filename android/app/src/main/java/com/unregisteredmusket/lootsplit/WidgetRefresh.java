package com.unregisteredmusket.lootsplit;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** A user tap runs now, within the foreground broadcast's ten-second lifetime. */
final class WidgetRefresh {
    interface Fetcher { JSONObject fetch(String token) throws Exception; }
    interface Completion { void finish(String error); }
    // Package-private injection is used only by native instrumentation, never by app/JS input.
    static volatile Fetcher fetcher = WidgetClient::fetch;
    private static final ExecutorService NETWORK = Executors.newFixedThreadPool(2);
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor();
    private static Task active;
    /** Ends every tap/job inside the ten-second broadcast lifetime; HTTP limits are shorter. */
    static final long TASK_DEADLINE_MILLIS = 8000;
    // At most one network fetch per account generation. A fetch that outlived its task deadline
    // (e.g. DNS that ignores interruption) keeps running; later taps wait for that fetch instead of
    // queueing another one behind it on the small NETWORK pool.
    private static Task fetching;
    // Modern Android may serialize broadcasts until the first goAsync result finishes.
    // A queued double-tap can therefore arrive just after the shared request completes.
    private static String lastSuccessfulGeneration = "";
    private static long lastSuccessfulAt;
    private static final long SUCCESS_COALESCE_MILLIS = 2000;

    static final class Task {
        final Context context;
        final String generation;
        final List<Completion> completions = new ArrayList<>();
        boolean manual, done;
        Task successor;
        Thread worker;
        Future<?> work;
        ScheduledFuture<?> deadline;
        Task(Context context, String generation, boolean manual) {
            this.context = context; this.generation = generation; this.manual = manual;
        }
    }

    static synchronized Task request(Context context, boolean manual, Completion completion) {
        return request(context, manual, false, completion);
    }

    /** {@code quiet}: an Agent activity tick keeps the last reading on screen instead of showing "Refreshing…". */
    static synchronized Task request(Context context, boolean manual, boolean quiet, Completion completion) {
        Context app = context.getApplicationContext();
        WidgetClient.initialize(app);
        JSONObject state = WidgetStore.read(app);
        String token = state.optString("token"), generation = state.optString("generation");
        if (state.optBoolean(WidgetStore.UNAVAILABLE)) {
            // Transient Keystore/IO failure: the saved connection is kept; retry later.
            completion.finish(STORAGE_BUSY);
            return null;
        }
        if (token.isEmpty()) {
            // Not connected: nothing to fetch. Redraw so the face says so (and why) instead of
            // implying that a reading is on its way.
            OwnerWidgetProvider.renderAll(app);
            completion.finish(NOT_CONNECTED);
            return null;
        }
        if (active != null && !active.done && active.generation.equals(generation)) {
            active.manual |= manual;
            active.completions.add(completion);
            return active;
        }
        if (manual && generation.equals(lastSuccessfulGeneration)
                && android.os.SystemClock.elapsedRealtime() - lastSuccessfulAt < SUCCESS_COALESCE_MILLIS
                && state.optJSONObject("snapshot") != null && state.optString("message").isEmpty()) {
            completion.finish("");
            return null;
        }
        Task task = new Task(app, generation, manual);
        task.completions.add(completion);
        active = task;
        try {
            if (!quiet) {
                WidgetStore.message(app, generation, "Refreshing…");
                OwnerWidgetProvider.renderAll(app);
            }
        } catch (Exception failure) {
            finish(task, null, storageError(failure), false);
            return task;
        }
        // Finish the broadcast even if a DNS/socket implementation ignores interruption.
        // A timed-out operation can never commit a late response or clear a newer account.
        task.deadline = DEADLINES.schedule(() ->
            finish(task, null, TIMED_OUT, false), TASK_DEADLINE_MILLIS, TimeUnit.MILLISECONDS);
        if (fetching != null && fetching.generation.equals(generation)) {
            // Its result (same account generation) completes this task too, or the deadline does.
            fetching.successor = task;
            return task;
        }
        fetching = task;
        Fetcher source = fetcher;
        task.work = NETWORK.submit(() -> {
            synchronized (WidgetRefresh.class) { task.worker = Thread.currentThread(); }
            JSONObject snapshot = null; String error = ""; boolean denied = false;
            try { snapshot = source.fetch(token); }
            catch (WidgetClient.AccessDenied ignored) {
                error = "Owner session expired. Sign in again in My account."; denied = true;
            } catch (Exception ignored) {
                error = FAILED;
            }
            Task waiting;
            synchronized (WidgetRefresh.class) {
                if (fetching == task) fetching = null;
                waiting = task.successor;
                task.successor = null;
            }
            finish(task, snapshot, error, denied);
            // A newer tap for the same generation adopts this result; a changed account never does
            // (the successor shares this generation, and WidgetStore rechecks it before committing).
            if (waiting != null) finish(waiting, snapshot == null ? null : copy(snapshot), error, denied);
        });
        return task;
    }

    /**
     * Connect's first fetch failed in transport (timeout, no response, invalid reading): the saved
     * connection stays and shows the normal retry message. Returns false when the account changed
     * meanwhile or storage failed; then the connection is cleared as before.
     */
    static boolean keepAfterConnectFailure(Context context, String generation) {
        try { if (WidgetStore.message(context, generation, FAILED)) return true; }
        catch (Exception ignored) { }
        WidgetStore.clearGeneration(context, generation, WidgetStore.REASON_CONNECT);
        return false;
    }

    /** A transient Keystore/IO write failure keeps the connection; only a lost key needs reconnecting. */
    static String storageError(Exception failure) {
        return WidgetStore.permanent(failure) ? "Widget storage unavailable. Reconnect in My account." : STORAGE_BUSY;
    }

    private static JSONObject copy(JSONObject value) {
        try { return new JSONObject(value.toString()); } catch (org.json.JSONException impossible) { return value; }
    }

    // Agent activity: while a GitHub workflow runs and an Agent activity companion is placed, check
    // about once a minute. The alarm is RTC (never RTC_WAKEUP) and inexact, so it never wakes the
    // device; a tick arriving while the screen is off only re-arms. Otherwise the persisted ~30 minute
    // OwnerWidgetJob remains the only background cadence.
    static final String ACTIVITY_TICK = "com.unregisteredmusket.lootsplit.ACTIVITY_REFRESH";
    static final long ACTIVITY_INTERVAL_MILLIS = 60000;
    /** A reading older than this stops the fast cadence; the periodic job takes over. */
    static final long ACTIVITY_MAX_AGE_MILLIS = 1800000;
    static boolean activityFast(JSONObject state, JSONObject[] companions, long now) {
        if (state == null || state.optString("token").isEmpty()) return false;
        JSONObject snapshot = state.optJSONObject("snapshot");
        if (snapshot == null || now - snapshot.optLong("checkedAt") > ACTIVITY_MAX_AGE_MILLIS) return false;
        JSONObject activity = snapshot.optJSONObject("activity");
        if (activity == null || !"ready".equals(activity.optString("state")) || activity.optInt("active") <= 0) return false;
        for (JSONObject settings : companions) if (CompanionSettings.showsActivity(settings)) return true;
        return false;
    }
    /** Package-private seam so instrumentation can observe alarm type/cancellation; never app or JS input. */
    interface ActivityAlarm { void set(Context context, int type, long at, PendingIntent tick); void cancel(Context context, PendingIntent tick); }
    static volatile ActivityAlarm alarm = new ActivityAlarm() {
        @Override public void set(Context context, int type, long at, PendingIntent tick) { context.getSystemService(AlarmManager.class).set(type, at, tick); }
        @Override public void cancel(Context context, PendingIntent tick) { context.getSystemService(AlarmManager.class).cancel(tick); }
    };
    static PendingIntent activityIntent(Context context) {
        return PendingIntent.getBroadcast(context, 197402, new Intent(context, OwnerWidgetProvider.class).setAction(ACTIVITY_TICK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    /** Re-evaluated after every render: arms the next tick, or cancels it when nothing is active. */
    static void scheduleActivity(Context context) {
        try {
            int[] ids = CompanionWidgetProvider.ids(context);
            JSONObject[] companions = new JSONObject[ids.length];
            for (int i = 0; i < ids.length; i++) companions[i] = CompanionSettings.read(context, ids[i]);
            // RTC, never RTC_WAKEUP; set() is inexact, so Android may batch it with other alarms.
            if (activityFast(WidgetStore.read(context), companions, System.currentTimeMillis()))
                alarm.set(context, AlarmManager.RTC, System.currentTimeMillis() + ACTIVITY_INTERVAL_MILLIS, activityIntent(context));
            else alarm.cancel(context, activityIntent(context));
        } catch (RuntimeException ignored) { /* The periodic job remains; a widget render never fails here. */ }
    }
    static void cancelActivity(Context context) {
        try { alarm.cancel(context, activityIntent(context)); }
        catch (RuntimeException ignored) { }
    }
    /** Tick from the non-wakeup alarm: refresh only while the screen is on; otherwise just re-arm. */
    static boolean activityTick(Context context, Completion completion) {
        android.os.PowerManager power = context.getSystemService(android.os.PowerManager.class);
        if (power != null && !power.isInteractive()) { scheduleActivity(context); return false; }
        // A coalesced or signed-out request renders nothing, so re-evaluate the cadence here.
        if (request(context, false, true, completion) == null) scheduleActivity(context);
        return true;
    }

    /** Shown, with the recorded reason, wherever a disconnected widget would otherwise offer a reading. */
    static final String NOT_CONNECTED = "Not connected — tap Sign in";
    static final String FAILED = "Could not refresh · tap Refresh to retry", TIMED_OUT = "Refresh timed out · tap Refresh to retry",
        STORAGE_BUSY = "Widget storage busy · tap Refresh to retry";
    /** Transport and transient storage failures are worth a background retry; authorization and account errors are not. */
    static boolean transientFailure(String error) { return FAILED.equals(error) || TIMED_OUT.equals(error) || STORAGE_BUSY.equals(error); }

    static synchronized void cancelBackground(Task task) {
        if (task != null && !task.manual)
            finish(task, null, "Background check paused · tap Refresh to retry", false);
    }

    private static void finish(Task task, JSONObject snapshot, String error, boolean denied) {
        List<Completion> callbacks;
        synchronized (WidgetRefresh.class) {
            if (task.done) return;
            task.done = true;
            if (task.deadline != null) task.deadline.cancel(false);
            if (task.work != null && task.worker != Thread.currentThread()) task.work.cancel(true);
            if (active == task) active = null;
            try {
                boolean current;
                if (denied) current = WidgetStore.revoke(task.context, task.generation, "Owner authorization was rejected. Tap Sign in to reconnect.");
                else if (snapshot != null) current = WidgetStore.finish(task.context, task.generation, snapshot, "");
                else current = WidgetStore.message(task.context, task.generation, error);
                if (!current) error = "Account changed. Refresh the current account.";
                else if (snapshot != null && error.isEmpty()) {
                    lastSuccessfulGeneration = task.generation;
                    lastSuccessfulAt = android.os.SystemClock.elapsedRealtime();
                }
            } catch (Exception failure) { error = storageError(failure); }
            callbacks = new ArrayList<>(task.completions);
            task.completions.clear();
        }
        try { OwnerWidgetProvider.renderAll(task.context); }
        finally {
            for (Completion callback : callbacks) {
                try { callback.finish(error); }
                catch (RuntimeException ignored) { /* Always release the other broadcast/job callbacks. */ }
            }
        }
    }
}
