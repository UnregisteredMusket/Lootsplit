package com.unregisteredmusket.lootsplit;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;

@RunWith(AndroidJUnit4.class)
public class OwnerWidgetTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    @After public void cleanup() { WidgetStore.clear(context, null); OwnerWidgetJob.cancel(context); }

    private JSONObject fixture() throws Exception {
        long now = System.currentTimeMillis();
        return new JSONObject("{\"account\":{\"name\":\"Test Owner\",\"email\":\"widget@example.invalid\"},"
            + "\"health\":{\"status\":\"healthy\",\"checks\":[{\"name\":\"Database\",\"status\":\"healthy\"},{\"name\":\"Website assets\",\"status\":\"healthy\"}],"
            + "\"stats\":{\"active5m\":12,\"accounts\":128,\"sharedCampaigns\":24,\"cloudBackups\":83}},"
            + "\"traffic\":{\"state\":\"not-connected\",\"data\":null},"
            + "\"analytics\":{\"state\":\"ready\",\"data\":{\"version\":1,\"scope\":\"current-shared-campaigns\",\"metrics\":{\"sessions\":57,\"transactionCount\":412}}},"
            + "\"development\":{\"state\":\"ready\",\"data\":{\"active\":[{\"deployment\":true,\"status\":\"in_progress\"}],\"openPulls\":[{}],\"latestDeployment\":{\"status\":\"completed\",\"conclusion\":\"success\"}}},"
            + "\"release\":{\"state\":\"ready\",\"data\":{\"commit\":\"0123456789012345678901234567890123456789\"}}}")
            .put("checkedAt", now);
    }

    @Test public void absentReadingsAndSourceErrorsStayExplicit() throws Exception {
        JSONObject source = fixture();
        JSONObject snapshot = WidgetData.project(source, System.currentTimeMillis());
        assertEquals("Not connected", snapshot.getString("traffic"));
        assertEquals("Deploy: in_progress", snapshot.getString("deployment"));
        source.getJSONObject("health").remove("stats");
        source.getJSONObject("traffic").put("state", "unavailable");
        source.getJSONObject("analytics").getJSONObject("data").put("version", 900);
        snapshot = WidgetData.project(source, System.currentTimeMillis());
        assertEquals("—", snapshot.getString("active"));
        assertEquals("Unavailable", snapshot.getString("traffic"));
        assertEquals("Unavailable", snapshot.getString("games"));
        assertEquals("—", WidgetData.count(new JSONObject().put("x", -1), "x"));
        assertEquals("—", WidgetData.count(new JSONObject().put("x", "0"), "x"));
        source.put("checkedAt", System.currentTimeMillis() - 700000);
        try { WidgetData.project(source, System.currentTimeMillis()); fail("Old snapshots must be rejected"); }
        catch (Exception expected) { }
    }

    @Test public void disconnectAndAccountSwitchRejectInFlightResults() throws Exception {
        String token = "synthetic-token-never-a-real-account";
        String generation = WidgetStore.connect(context, token);
        JSONObject snapshot = WidgetData.project(fixture(), System.currentTimeMillis());
        assertTrue(WidgetStore.finish(context, generation, snapshot, ""));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (FileInputStream input = new FileInputStream(WidgetStore.file(context))) {
            byte[] buffer = new byte[4096]; int size;
            while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
        }
        byte[] encrypted = output.toByteArray();
        String bytes = new String(encrypted, StandardCharsets.ISO_8859_1);
        assertFalse(bytes.contains(token));
        assertFalse(bytes.contains("widget@example.invalid"));
        assertTrue(WidgetStore.file(context).getCanonicalPath().startsWith(context.getNoBackupFilesDir().getCanonicalPath()));
        WidgetStore.clear(context, null);
        assertFalse(WidgetStore.finish(context, generation, snapshot, ""));
        assertFalse(WidgetStore.file(context).exists());
        String next = WidgetStore.connect(context, "another-synthetic-session");
        assertFalse(WidgetStore.clear(context, token));
        assertFalse(WidgetStore.finish(context, generation, snapshot, ""));
        assertEquals(next, WidgetStore.read(context).getString("generation"));
        assertNull(WidgetStore.read(context).optJSONObject("snapshot"));
    }

    private static final class FakeConnection extends HttpsURLConnection {
        final int code; final byte[] bytes; boolean disconnected;
        FakeConnection(int code, String body) throws Exception {
            super(new URL(WidgetClient.ENDPOINT)); this.code = code; bytes = body.getBytes(StandardCharsets.UTF_8);
        }
        @Override public int getResponseCode() { return code; }
        @Override public String getContentType() { return "application/json"; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(bytes); }
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
        @Override public String getCipherSuite() { return "test"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return null; }
    }

    @Test public void transportIsBoundedPrivateAndNeverFollowsRedirects() throws Exception {
        FakeConnection ok = new FakeConnection(200, fixture().toString());
        assertEquals("Test Owner", WidgetClient.fetch("synthetic", () -> ok, System.currentTimeMillis()).getString("name"));
        assertEquals("Bearer synthetic", ok.getRequestProperty("Authorization"));
        assertEquals("no-store", ok.getRequestProperty("Cache-Control"));
        assertFalse(ok.getUseCaches()); assertFalse(ok.getInstanceFollowRedirects());
        assertTrue(ok.getConnectTimeout() > 0); assertTrue(ok.getReadTimeout() > 0); assertTrue(ok.disconnected);
        for (int code : new int[]{301, 302, 401, 403, 500}) {
            FakeConnection failed = new FakeConnection(code, fixture().toString());
            try { WidgetClient.fetch("synthetic", () -> failed, System.currentTimeMillis()); fail("Rejected status " + code); }
            catch (WidgetClient.AccessDenied expected) { assertTrue(code == 401 || code == 403); }
            catch (Exception expected) { assertTrue(code != 401 && code != 403); }
            assertTrue(failed.disconnected);
        }
        FakeConnection large = new FakeConnection(200, new String(new char[262145]).replace('\0', 'x'));
        try { WidgetClient.fetch("synthetic", () -> large, System.currentTimeMillis()); fail("Oversize response"); }
        catch (Exception expected) { assertTrue(large.disconnected); }
    }

    @Test public void fullCompactUnavailableAndSignedOutViewsRender() throws Exception {
        JSONObject snapshot = WidgetData.project(fixture(), System.currentTimeMillis());
        JSONObject state = new JSONObject().put("token", "synthetic").put("snapshot", snapshot);
        for (int width : new int[]{250, 350, 448}) {
            render(state, false, width, 300, "compact-" + width);
            render(state, true, width, 540, "full-" + width);
        }
        render(new JSONObject().put("message", "Connect in My account"), false, 350, 300, "signed-out");
        render(new JSONObject().put("token", "synthetic").put("message", "Offline or unavailable · tap refresh"), true, 350, 540, "unavailable");
        snapshot.put("checkedAt", System.currentTimeMillis() - 3600001);
        render(state, false, 350, 300, "stale");
    }

    private void render(JSONObject state, boolean expanded, int width, int height, String name) throws Exception {
        final Throwable[] failure = new Throwable[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                float density = context.getResources().getDisplayMetrics().density;
                FrameLayout parent = new FrameLayout(context);
                View view = OwnerWidgetProvider.views(context, state, expanded).apply(context, parent);
                parent.addView(view);
                int w = Math.round(width * density), h = Math.round(height * density);
                parent.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
                parent.layout(0, 0, w, h);
                Bitmap image = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                parent.draw(new Canvas(image));
                File dir = context.getExternalFilesDir("widget-audit");
                if (dir == null || (!dir.isDirectory() && !dir.mkdirs())) throw new Exception("Missing screenshot directory");
                try (FileOutputStream output = new FileOutputStream(new File(dir, name + ".png"))) { image.compress(Bitmap.CompressFormat.PNG, 100, output); }
                image.recycle();
                assertEquals(expanded ? View.VISIBLE : View.GONE, view.findViewById(R.id.monitor_details).getVisibility());
                assertTrue(view.findViewById(R.id.monitor_refresh).getHeight() >= 40 * density);
                assertTrue(view.findViewById(R.id.monitor_refresh).hasOnClickListeners());
                assertTrue(view.findViewById(R.id.monitor_account).hasOnClickListeners());
                bounds(view);
                if (name.equals("signed-out") || name.equals("stale") || name.equals("unavailable")) {
                    assertEquals("—", ((TextView) view.findViewById(R.id.monitor_active)).getText().toString());
                    assertFalse(((TextView) view.findViewById(R.id.monitor_identity)).getText().toString().contains("Test Owner"));
                }
            } catch (Throwable error) { failure[0] = error; }
        });
        if (failure[0] != null) throw new AssertionError(name, failure[0]);
    }
    private void bounds(View view) {
        if (!(view instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) view;
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            if (child.getVisibility() != View.VISIBLE) continue;
            assertTrue("Vertical clipping " + child.getId(), child.getBottom() <= group.getHeight() + 1);
            assertTrue("Horizontal clipping " + child.getId(), child.getRight() <= group.getWidth() + 1);
            bounds(child);
        }
    }
}
