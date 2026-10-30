package com.unregisteredmusket.lootsplit;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

final class WidgetClient {
    private static android.content.Context appContext;
    static void initialize(android.content.Context context) { appContext = context.getApplicationContext(); }
    // The compact widget view omits only lists the widgets never read (the 100 scanned workflow runs,
    // closed pull requests, device reports), keeping the response far below the 256 KiB bound.
    static final String ENDPOINT = "https://lootsplit.oliverstorie2017.workers.dev/api/account/owner/monitor?view=widget";
    static final class AccessDenied extends Exception { }
    // Every HTTP limit ends inside WidgetRefresh's task deadline, so a slow server or network
    // releases the fetch thread instead of holding it past the tap/job that started it.
    // The read limit covers the server's work before its first byte. 1.16.0 (2026-10-30): at 4 s the
    // owner's phone discarded valid readings for a day; the server measured 2.2–9.4 s per refresh
    // before cold start and phone network time. 6 s, with a shorter connect limit, is the most a
    // tap can wait and still finish inside Android's ten-second broadcast lifetime.
    static final int CONNECT_TIMEOUT_MILLIS = 2500, READ_TIMEOUT_MILLIS = 6000;
    static final long TOTAL_TIMEOUT_MILLIS = 8500;
    // Disconnecting from another thread aborts a blocked connect/read that the per-call socket
    // timeouts alone cannot bound (a slow trickle, or a read already waiting when the total expires).
    private static final java.util.concurrent.ScheduledExecutorService WATCHDOG =
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    interface ConnectionFactory { HttpsURLConnection open() throws Exception; }

    static JSONObject fetch(String token) throws Exception {
        return fetch(token, () -> (HttpsURLConnection) new URL(ENDPOINT).openConnection(), System.currentTimeMillis());
    }
    static JSONObject fetch(String token, ConnectionFactory factory, long now) throws Exception {
        long deadline = System.nanoTime() + TOTAL_TIMEOUT_MILLIS * 1000000L;
        HttpsURLConnection connection = factory.open();
        java.util.concurrent.ScheduledFuture<?> watchdog = WATCHDOG.schedule(connection::disconnect,
            TOTAL_TIMEOUT_MILLIS, java.util.concurrent.TimeUnit.MILLISECONDS);
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
            connection.setReadTimeout(READ_TIMEOUT_MILLIS);
            connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-store");
            if (appContext != null) {
                connection.setRequestProperty("X-Lootsplit-Device", WidgetStore.deviceId(appContext));
                JSONObject previous = WidgetStore.read(appContext).optJSONObject("snapshot");
                connection.setRequestProperty("X-Lootsplit-Snapshot", Long.toString(previous == null ? 0 : previous.optLong("snapshotId")));
                try { connection.setRequestProperty("X-Lootsplit-Version", appContext.getPackageManager().getPackageInfo(appContext.getPackageName(), 0).versionName); } catch (Exception ignored) { }
            }
            int code = connection.getResponseCode();
            if (code == 401 || code == 403) throw new AccessDenied();
            String contentType = connection.getContentType();
            if (code != 200 || contentType == null || !contentType.startsWith("application/json"))
                throw new Exception("Monitor unavailable");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline || output.size() + size > 262144)
                        throw new Exception("Invalid response size");
                    output.write(buffer, 0, size);
                }
                return WidgetData.project(new JSONObject(output.toString(StandardCharsets.UTF_8.name())), now);
            }
        } finally { watchdog.cancel(false); connection.disconnect(); }
    }

}
