package com.unregisteredmusket.lootsplit;

import android.content.Context;
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

    static final class Task {
        final Context context;
        final String generation;
        final List<Completion> completions = new ArrayList<>();
        boolean manual, done;
        Thread worker;
        Future<?> work;
        ScheduledFuture<?> deadline;
        Task(Context context, String generation, boolean manual) {
            this.context = context; this.generation = generation; this.manual = manual;
        }
    }

    static synchronized Task request(Context context, boolean manual, Completion completion) {
        Context app = context.getApplicationContext();
        JSONObject state = WidgetStore.read(app);
        String token = state.optString("token"), generation = state.optString("generation");
        if (token.isEmpty()) {
            completion.finish("Connect your owner account in My account.");
            return null;
        }
        if (active != null && !active.done && active.generation.equals(generation)) {
            active.manual |= manual;
            active.completions.add(completion);
            return active;
        }
        Task task = new Task(app, generation, manual);
        task.completions.add(completion);
        active = task;
        try {
            WidgetStore.message(app, generation, "Refreshing…");
            OwnerWidgetProvider.renderAll(app);
        } catch (Exception ignored) {
            finish(task, null, "Widget storage unavailable. Reconnect in My account.", false);
            return task;
        }
        // Finish the broadcast even if a DNS/socket implementation ignores interruption.
        // A timed-out operation can never commit a late response or clear a newer account.
        task.deadline = DEADLINES.schedule(() ->
            finish(task, null, "Refresh timed out · tap Refresh to retry", false), 8, TimeUnit.SECONDS);
        Fetcher source = fetcher;
        task.work = NETWORK.submit(() -> {
            synchronized (WidgetRefresh.class) { task.worker = Thread.currentThread(); }
            try { finish(task, source.fetch(token), "", false); }
            catch (WidgetClient.AccessDenied ignored) {
                finish(task, null, "Owner session expired. Sign in again in My account.", true);
            } catch (Exception ignored) {
                finish(task, null, "Could not refresh · tap Refresh to retry", false);
            }
        });
        return task;
    }

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
                if (denied) current = WidgetStore.clearGeneration(task.context, task.generation);
                else if (snapshot != null) current = WidgetStore.finish(task.context, task.generation, snapshot, "");
                else current = WidgetStore.message(task.context, task.generation, error);
                if (!current) error = "Account changed. Refresh the current account.";
            } catch (Exception ignored) { error = "Widget storage unavailable. Reconnect in My account."; }
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
