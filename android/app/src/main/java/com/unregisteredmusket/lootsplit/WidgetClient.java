package com.unregisteredmusket.lootsplit;

import android.content.Context;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

final class WidgetClient {
    static final String ENDPOINT = "https://lootsplit.oliverstorie2017.workers.dev/api/account/owner/monitor";
    static final class AccessDenied extends Exception { }
    interface ConnectionFactory { HttpsURLConnection open() throws Exception; }

    static JSONObject fetch(String token) throws Exception {
        return fetch(token, () -> (HttpsURLConnection) new URL(ENDPOINT).openConnection(), System.currentTimeMillis());
    }
    static JSONObject fetch(String token, ConnectionFactory factory, long now) throws Exception {
        long deadline = System.nanoTime() + 20000000000L;
        HttpsURLConnection connection = factory.open();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(12000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-store");
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
        } finally { connection.disconnect(); }
    }

    static void refresh(Context context) {
        JSONObject current = WidgetStore.read(context);
        String token = current.optString("token"), generation = current.optString("generation");
        if (token.isEmpty()) return;
        try {
            JSONObject snapshot = fetch(token);
            if (!Thread.currentThread().isInterrupted()) WidgetStore.finish(context, generation, snapshot, "");
        } catch (AccessDenied denied) {
            WidgetStore.clearGeneration(context, generation);
        } catch (Exception ignored) {
            try { WidgetStore.finish(context, generation, null, "Offline or unavailable · tap refresh"); }
            catch (Exception storageFailure) { /* Storage fails closed. */ }
        }
        OwnerWidgetProvider.renderAll(context);
    }
}
