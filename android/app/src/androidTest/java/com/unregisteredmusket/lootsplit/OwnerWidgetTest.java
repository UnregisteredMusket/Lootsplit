package com.unregisteredmusket.lootsplit;

import static org.junit.Assert.*;
import android.content.Context;
import android.app.job.JobScheduler;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
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
    @After public void cleanup() {
        WidgetStore.clear(context, null); OwnerWidgetJob.cancel(context);
        WidgetRefresh.fetcher = WidgetClient::fetch;
        WidgetRefresh.alarm = DEFAULT_ALARM; WidgetRefresh.cancelActivity(context);
        WidgetStore.keys = DEFAULT_KEYS; WidgetStore.forgetCache();
    }
    private static final WidgetStore.KeySource DEFAULT_KEYS = WidgetStore.keys;
    private static final WidgetRefresh.ActivityAlarm DEFAULT_ALARM = WidgetRefresh.alarm;

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
            render(state, true, width, 480, "full-" + width);
        }
        render(new JSONObject().put("message", "Connect in My account"), false, 350, 300, "signed-out");
        render(new JSONObject().put("token", "synthetic").put("message", "Offline or unavailable · tap refresh"), true, 350, 480, "unavailable");
        snapshot.put("checkedAt", System.currentTimeMillis() - 3600001);
        render(state, false, 350, 300, "stale");
    }

    @Test public void launcherRefreshRunsWithoutOpeningAccountAndRetainsReading() throws Exception {
        String generation = WidgetStore.connect(context, "synthetic-home-refresh");
        JSONObject old = WidgetData.project(fixture(), System.currentTimeMillis());
        old.put("checkedAt", System.currentTimeMillis() - 60000);
        WidgetStore.finish(context, generation, old, "");
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), done = new CountDownLatch(1);
        AtomicInteger requests = new AtomicInteger();
        WidgetRefresh.fetcher = token -> {
            assertEquals("synthetic-home-refresh", token);
            requests.incrementAndGet(); started.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            JSONObject source = fixture();
            source.getJSONObject("health").getJSONObject("stats").put("accounts", 129);
            return WidgetClient.fetch(token, () -> new FakeConnection(200, source.toString()), System.currentTimeMillis());
        };
        try {
            tapRefresh();
            assertTrue("Home tap must start networking without an activity", started.await(2, TimeUnit.SECONDS));
            assertNull(context.getSystemService(JobScheduler.class).getPendingJob(OwnerWidgetJob.ID));
            JSONObject waiting = WidgetStore.read(context);
            assertEquals("Refreshing…", waiting.getString("message"));
            assertEquals("Test Owner", waiting.getJSONObject("snapshot").getString("name"));
            assertEquals(old.getLong("checkedAt"), waiting.getJSONObject("snapshot").getLong("checkedAt"));
            render(waiting, true, 350, 480, "refreshing");
            tapRefresh();
            WidgetRefresh.request(context, true, error -> { assertEquals("", error); done.countDown(); });
            release.countDown();
            assertTrue(done.await(3, TimeUnit.SECONDS));
            // API35 may deliver the queued second broadcast only after the first finishes.
            // Also exercise that post-completion arrival deterministically through the same path.
            CountDownLatch queued = new CountDownLatch(1);
            assertNull(WidgetRefresh.request(context, true, error -> { assertEquals("", error); queued.countDown(); }));
            assertTrue(queued.await(1, TimeUnit.SECONDS));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertEquals("Rapid taps coalesce into one check", 1, requests.get());
            JSONObject refreshed = WidgetStore.read(context);
            assertEquals("129", refreshed.getJSONObject("snapshot").getString("accounts"));
            assertEquals("", refreshed.getString("message"));
            render(refreshed, true, 350, 480, "refreshed");
        } finally { release.countDown(); }
    }

    @Test public void failedRefreshKeepsDatedDataButAccessDenialClearsIt() throws Exception {
        String generation = WidgetStore.connect(context, "synthetic-failure");
        JSONObject old = WidgetData.project(fixture(), System.currentTimeMillis());
        WidgetStore.finish(context, generation, old, "");
        WidgetRefresh.fetcher = token -> { throw new java.io.IOException("synthetic network failure"); };
        CountDownLatch failed = new CountDownLatch(1);
        WidgetRefresh.request(context, true, error -> { assertTrue(error.contains("Could not refresh")); failed.countDown(); });
        assertTrue(failed.await(2, TimeUnit.SECONDS));
        JSONObject cached = WidgetStore.read(context);
        assertEquals(old.toString(), cached.getJSONObject("snapshot").toString());
        render(cached, false, 350, 300, "cached-error-compact");
        render(cached, true, 350, 480, "cached-error-full");
        WidgetRefresh.fetcher = token -> { throw new WidgetClient.AccessDenied(); };
        CountDownLatch denied = new CountDownLatch(1);
        WidgetRefresh.request(context, true, error -> denied.countDown());
        assertTrue(denied.await(2, TimeUnit.SECONDS));
        assertEquals("", WidgetStore.read(context).optString("token"));
        assertNull(WidgetStore.read(context).optJSONObject("snapshot"));
    }

    @Test public void deadlineReleasesTapAndLateResponseCannotReplaceNewAccount() throws Exception {
        String generation = WidgetStore.connect(context, "synthetic-slow");
        WidgetStore.finish(context, generation, WidgetData.project(fixture(), System.currentTimeMillis()), "");
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), late = new CountDownLatch(1), done = new CountDownLatch(1);
        AtomicReference<String> errorText = new AtomicReference<>();
        WidgetRefresh.fetcher = token -> {
            started.countDown();
            // Simulate a network stack that ignores interruption until its socket deadline.
            boolean waiting = true;
            while (waiting) { try { release.await(); waiting = false; } catch (InterruptedException ignored) { } }
            late.countDown();
            throw new WidgetClient.AccessDenied();
        };
        try {
            long start = android.os.SystemClock.elapsedRealtime();
            tapRefresh();
            assertTrue(started.await(2, TimeUnit.SECONDS));
            WidgetRefresh.request(context, true, error -> { errorText.set(error); done.countDown(); });
            assertTrue("Must finish before the ten-second broadcast limit", done.await(9, TimeUnit.SECONDS));
            assertTrue(android.os.SystemClock.elapsedRealtime() - start < 9500);
            assertTrue(errorText.get().contains("timed out"));
            assertNotNull(WidgetStore.read(context).optJSONObject("snapshot"));
            String next = WidgetStore.connect(context, "synthetic-new-owner");
            release.countDown();
            assertTrue(late.await(2, TimeUnit.SECONDS));
            assertEquals(next, WidgetStore.read(context).getString("generation"));
            assertEquals("synthetic-new-owner", WidgetStore.read(context).getString("token"));
        } finally { release.countDown(); }
    }

    @Test public void transientKeystoreErrorKeepsConnectionButCorruptionClearsIt() throws Exception {
        String generation = WidgetStore.connect(context, "synthetic-keystore");
        JSONObject old = WidgetData.project(fixture(), System.currentTimeMillis());
        assertTrue(WidgetStore.finish(context, generation, old, ""));
        // A busy Keystore while a new process first reads the file: report it, keep the file.
        WidgetStore.keys = () -> { throw new java.security.KeyStoreException("synthetic busy keystore"); };
        WidgetStore.forgetCache();
        JSONObject busy = WidgetStore.read(context);
        assertTrue(busy.optBoolean(WidgetStore.UNAVAILABLE));
        assertEquals("", busy.optString("token"));
        assertTrue("Transient errors must not delete the credential", WidgetStore.file(context).exists());
        CountDownLatch refused = new CountDownLatch(1);
        AtomicReference<String> errorText = new AtomicReference<>();
        assertNull(WidgetRefresh.request(context, true, error -> { errorText.set(error); refused.countDown(); }));
        assertTrue(refused.await(1, TimeUnit.SECONDS));
        assertEquals(WidgetRefresh.STORAGE_BUSY, errorText.get());
        assertTrue(WidgetRefresh.transientFailure(errorText.get()));
        View widget = OwnerWidgetProvider.views(context, busy, true).apply(context, new FrameLayout(context));
        assertEquals("Busy storage offers Refresh, not Sign in", "LOGS", ((TextView) widget.findViewById(R.id.monitor_open)).getText().toString());
        WidgetStore.keys = DEFAULT_KEYS;
        assertEquals("synthetic-keystore", WidgetStore.read(context).getString("token"));
        assertEquals(generation, WidgetStore.read(context).getString("generation"));
        // A busy Keystore during a write keeps the previous file and connection.
        WidgetStore.keys = () -> { throw new java.security.ProviderException("synthetic busy keystore"); };
        try { WidgetStore.message(context, generation, "Refreshing…"); fail("Write must report the failure"); }
        catch (Exception expected) { assertFalse(WidgetStore.permanent(expected)); }
        assertEquals(WidgetRefresh.STORAGE_BUSY, WidgetRefresh.storageError(new java.security.ProviderException("busy")));
        WidgetStore.keys = DEFAULT_KEYS; WidgetStore.forgetCache();
        assertEquals("synthetic-keystore", WidgetStore.read(context).getString("token"));
        assertEquals(old.toString(), WidgetStore.read(context).getJSONObject("snapshot").toString());
        // Sign-out still removes a credential it cannot compare while storage is busy.
        WidgetStore.keys = () -> { throw new java.security.KeyStoreException("synthetic busy keystore"); };
        WidgetStore.forgetCache();
        assertTrue(WidgetStore.clear(context, "synthetic-keystore"));
        assertFalse(WidgetStore.file(context).exists());
        WidgetStore.keys = DEFAULT_KEYS; WidgetStore.forgetCache();
        // Confirmed corruption (bad tag / invalid length) still clears the stored connection.
        WidgetStore.connect(context, "synthetic-corrupt");
        byte[] garbage = new byte[64];
        new java.util.Random(7).nextBytes(garbage);
        try (FileOutputStream output = new FileOutputStream(WidgetStore.file(context))) { output.write(garbage); }
        WidgetStore.forgetCache();
        assertEquals("", WidgetStore.read(context).optString("token"));
        assertFalse(WidgetStore.read(context).optBoolean(WidgetStore.UNAVAILABLE));
        assertFalse(WidgetStore.file(context).exists());
        try (FileOutputStream output = new FileOutputStream(WidgetStore.file(context))) { output.write(new byte[3]); }
        WidgetStore.forgetCache();
        assertEquals("", WidgetStore.read(context).optString("token"));
        assertFalse(WidgetStore.file(context).exists());
    }

    @Test public void httpLimitsEndInsideTaskDeadlineAndWatchdogAbortsHungReads() throws Exception {
        assertTrue(WidgetClient.CONNECT_TIMEOUT_MILLIS + WidgetClient.READ_TIMEOUT_MILLIS <= WidgetClient.TOTAL_TIMEOUT_MILLIS);
        assertTrue("HTTP must give up before the task deadline", WidgetClient.TOTAL_TIMEOUT_MILLIS < WidgetRefresh.TASK_DEADLINE_MILLIS);
        assertTrue(WidgetRefresh.TASK_DEADLINE_MILLIS < 10000);
        HangingConnection hung = new HangingConnection();
        long start = android.os.SystemClock.elapsedRealtime();
        try { WidgetClient.fetch("synthetic", () -> hung, System.currentTimeMillis()); fail("A hung response must fail"); }
        catch (Exception expected) { }
        long elapsed = android.os.SystemClock.elapsedRealtime() - start;
        assertTrue("Watchdog disconnects at the total limit (" + elapsed + " ms)", elapsed >= WidgetClient.TOTAL_TIMEOUT_MILLIS - 100 && elapsed < WidgetRefresh.TASK_DEADLINE_MILLIS);
        assertTrue(hung.aborted);
        assertEquals(WidgetClient.CONNECT_TIMEOUT_MILLIS, hung.getConnectTimeout());
        assertEquals(WidgetClient.READ_TIMEOUT_MILLIS, hung.getReadTimeout());
    }

    @Test public void tapsAfterATimedOutFetchJoinItInsteadOfStackingAnother() throws Exception {
        String generation = WidgetStore.connect(context, "synthetic-stacked");
        WidgetStore.finish(context, generation, WidgetData.project(fixture(), System.currentTimeMillis() - 60000), "");
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1), timedOut = new CountDownLatch(1), adopted = new CountDownLatch(1);
        AtomicInteger fetches = new AtomicInteger();
        AtomicReference<String> second = new AtomicReference<>();
        WidgetRefresh.fetcher = token -> {
            fetches.incrementAndGet(); started.countDown();
            // A network stack that ignores interruption past the task deadline.
            boolean waiting = true;
            while (waiting) { try { release.await(); waiting = false; } catch (InterruptedException ignored) { } }
            JSONObject source = fixture();
            source.getJSONObject("health").getJSONObject("stats").put("accounts", 130);
            return WidgetData.project(source, System.currentTimeMillis());
        };
        try {
            assertNotNull(WidgetRefresh.request(context, true, error -> { assertTrue(error.contains("timed out")); timedOut.countDown(); }));
            assertTrue(started.await(2, TimeUnit.SECONDS));
            assertTrue(timedOut.await(WidgetRefresh.TASK_DEADLINE_MILLIS + 2000, TimeUnit.MILLISECONDS));
            // Repeated taps while that fetch still runs: no new fetch is queued behind it.
            assertNotNull(WidgetRefresh.request(context, true, error -> { second.set(error); adopted.countDown(); }));
            WidgetRefresh.request(context, true, error -> { });
            assertEquals("One fetch per account at a time", 1, fetches.get());
            release.countDown();
            assertTrue(adopted.await(3, TimeUnit.SECONDS));
            assertEquals("", second.get());
            assertEquals(1, fetches.get());
            assertEquals("130", WidgetStore.read(context).getJSONObject("snapshot").getString("accounts"));
            assertEquals("", WidgetStore.read(context).getString("message"));
        } finally { release.countDown(); }
    }

    @Test public void upgradeReceiverReturnsAtOnceAndFinishesWorkInBackground() throws Exception {
        WidgetStore.connect(context, "synthetic-upgrade");
        OwnerWidgetJob.cancel(context);
        AtomicReference<Long> spent = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            long start = android.os.SystemClock.elapsedRealtime();
            new WidgetInstallReceiver().onReceive(context, new android.content.Intent(android.content.Intent.ACTION_MY_PACKAGE_REPLACED));
            spent.set(android.os.SystemClock.elapsedRealtime() - start);
        });
        assertTrue("Receiver must not run registration on the main thread (" + spent.get() + " ms)", spent.get() < 200);
        long deadline = android.os.SystemClock.elapsedRealtime() + 5000;
        while (context.getSystemService(JobScheduler.class).getPendingJob(OwnerWidgetJob.ID) == null && android.os.SystemClock.elapsedRealtime() < deadline)
            android.os.SystemClock.sleep(50);
        assertNotNull("Background work still schedules the periodic check", context.getSystemService(JobScheduler.class).getPendingJob(OwnerWidgetJob.ID));
    }

    private static final class HangingConnection extends HttpsURLConnection {
        final CountDownLatch disconnected = new CountDownLatch(1); volatile boolean aborted;
        HangingConnection() throws Exception { super(new URL(WidgetClient.ENDPOINT)); }
        @Override public int getResponseCode() throws java.io.IOException {
            try { if (disconnected.await(30, TimeUnit.SECONDS)) { aborted = true; throw new java.net.SocketException("Socket closed"); } }
            catch (InterruptedException interrupted) { throw new java.io.InterruptedIOException(); }
            return 200;
        }
        @Override public String getContentType() { return "application/json"; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(new byte[0]); }
        @Override public void disconnect() { disconnected.countDown(); }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() { }
        @Override public String getCipherSuite() { return "test"; }
        @Override public Certificate[] getLocalCertificates() { return null; }
        @Override public Certificate[] getServerCertificates() { return null; }
    }

    private JSONObject journalFixture() throws Exception {
        JSONObject source=fixture(); long now=System.currentTimeMillis();
        source.put("snapshotId",42).put("schemaVersion",2)
            .put("overall",new JSONObject().put("color","yellow").put("label","Current status unverified").put("reason","Widget synchronization"))
            .put("monitoring",new JSONObject().put("summary","Accounts: 100 → 128 (+28%). Review missing sources."))
            .put("dailyReport",new JSONObject().put("summary","48 intervals; one source unavailable."))
            .put("developmentStatus",new JSONObject().put("task",new JSONObject().put("id","native-audit").put("revision",3).put("title","Monitoring widgets").put("objective","Independent refresh and synchronized history").put("phase","Native verification").put("progress","Collection scrolling check").put("state","testing").put("active",true).put("startedAt",now-120000).put("heartbeatAt",now).put("progressAt",now-30000).put("completedAt",0)))
            .put("diagnostics",new org.json.JSONArray().put(new JSONObject().put("component","GitHub").put("color","yellow").put("state","unavailable").put("symptom","The source did not respond.").put("action","Check the integration connection.")));
        return source;
    }
    @Test public void snapshotOrderingTimerPersistenceAndPerInstanceSettings() throws Exception {
        String generation=WidgetStore.connect(context,"synthetic-persistent");
        JSONObject snapshot=WidgetData.project(journalFixture(),System.currentTimeMillis());
        assertTrue(WidgetStore.finish(context,generation,snapshot,""));
        JSONObject older=new JSONObject(snapshot.toString()).put("snapshotId",41);
        assertFalse(WidgetStore.finish(context,generation,older,""));
        java.lang.reflect.Field memory=WidgetStore.class.getDeclaredField("state");memory.setAccessible(true);memory.set(null,null);
        assertEquals(42,WidgetStore.read(context).getJSONObject("snapshot").getLong("snapshotId"));
        assertEquals(snapshot.getJSONObject("task").getLong("startedAt"),WidgetStore.read(context).getJSONObject("snapshot").getJSONObject("task").getLong("startedAt"));
        CompanionSettings.save(context,101,CompanionSettings.preset("Development"));CompanionSettings.save(context,102,CompanionSettings.preset("Analytics"));
        assertEquals("task",CompanionSettings.read(context,101).getString("first"));assertEquals("analytics",CompanionSettings.read(context,102).getString("first"));
        OwnerWidgetJob.schedule(context);
        android.app.job.JobInfo job=context.getSystemService(JobScheduler.class).getPendingJob(OwnerWidgetJob.ID);
        assertNotNull(job);assertTrue(job.isPeriodic());assertTrue(job.isPersisted());assertEquals(1800000,job.getIntervalMillis());
        OwnerWidgetService.Factory factory=new OwnerWidgetService.Factory(context,generation);factory.onCreate();assertTrue(factory.getCount()>8);
        WidgetStore.clear(context,null);factory.onDataSetChanged();assertEquals(1,factory.getCount());
        CompanionSettings.remove(context,101);CompanionSettings.remove(context,102);
    }
    @Test public void companionFootprintPresetsThemesAndIndependentRefresh() throws Exception {
        String generation=WidgetStore.connect(context,"synthetic-companion");
        WidgetStore.finish(context,generation,WidgetData.project(journalFixture(),System.currentTimeMillis()),"");
        for(String preset:CompanionSettings.PRESETS) for(String theme:new String[]{"terminal","light","dark"}) {
            JSONObject settings=CompanionSettings.preset(preset).put("theme",theme);
            for(int width:new int[]{250,350,448}) renderCompanion(WidgetStore.read(context),settings,width,72,"companion-"+preset.replace(" ","-")+"-"+theme+"-"+width);
        }
        CountDownLatch refreshed=new CountDownLatch(1);
        renderCompanion(WidgetStore.read(context),CompanionSettings.preset("Development"),250,56,"minimum-4x1");
        WidgetRefresh.fetcher=token->{ assertEquals("synthetic-companion",token);refreshed.countDown();return WidgetData.project(journalFixture(),System.currentTimeMillis()); };
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            assertTrue(ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).isEmpty());
            View view=CompanionWidgetProvider.views(context,WidgetStore.read(context),CompanionSettings.preset("Development"),101).apply(context,new FrameLayout(context));
            assertTrue(view.findViewById(R.id.companion_action1).performClick());
        });
        assertTrue(refreshed.await(2,TimeUnit.SECONDS));
    }
    private View renderCompanion(JSONObject state,JSONObject settings,int width,int height,String name) throws Exception {
        AtomicReference<Throwable> failure=new AtomicReference<>();AtomicReference<View> rendered=new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{ try {
            FrameLayout parent=new FrameLayout(context);View view=CompanionWidgetProvider.views(context,state,settings,101).apply(context,parent);parent.addView(view);rendered.set(view);
            float density=context.getResources().getDisplayMetrics().density;int w=Math.round(width*density),h=Math.round(height*density);
            parent.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));parent.layout(0,0,w,h);bounds(view);
            assertTrue(view.findViewById(R.id.companion_action1).getWidth()>=44*density);assertTrue(view.findViewById(R.id.companion_action1).getHeight()>=44*density);
            assertTrue(view.findViewById(R.id.companion_action2).getWidth()>=44*density);assertTrue(view.findViewById(R.id.companion_action2).getHeight()>=44*density);
            assertTrue(view.findViewById(R.id.companion_action1).hasOnClickListeners());
            assertTrue(view.findViewById(R.id.companion_action2).hasOnClickListeners());
            for(int i=1;i<=2;i++){
                android.widget.ImageView action=view.findViewById(i==1?R.id.companion_action1:R.id.companion_action2);
                assertEquals("Icon action keeps its accessible label",WidgetActions.label(settings.optString("action"+i)),String.valueOf(action.getContentDescription()));
                assertNotNull(action.getDrawable());
            }
            String glyph=((TextView)view.findViewById(R.id.companion_light)).getText().toString();
            assertFalse("No stray ? glyph",glyph.contains("?"));
            assertTrue(glyph,java.util.Arrays.asList("✓","!","✕","–").contains(glyph));
            Bitmap bitmap=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);parent.draw(new Canvas(bitmap));
            File dir=context.getExternalFilesDir("widget-audit");if(dir!=null)dir.mkdirs();try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();
        }catch(Throwable error){failure.set(error);} });
        if(failure.get()!=null)throw new AssertionError(name,failure.get());
        return rendered.get();
    }
    private String shell(String command) throws Exception {
        try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] bytes=new byte[1024];int size;while((size=input.read(bytes))!=-1)out.write(bytes,0,size);return out.toString("UTF-8").trim();
        }
    }
    @Test public void collectionRowsKeepReadableThemesAndIndependentStatusColors() throws Exception {
        AtomicReference<Throwable> failure=new AtomicReference<>();
        for(String theme:new String[]{"terminal","light"}) for(String color:new String[]{"green","yellow","red"}) {
            CompanionSettings.save(context,103,CompanionSettings.preset("Server Health").put("theme",theme));
            JSONObject source=journalFixture();source.getJSONArray("diagnostics").getJSONObject(0).put("color",color);
            org.json.JSONArray rows=WidgetRows.rows(WidgetData.project(source,System.currentTimeMillis()));JSONObject diagnostic=null;
            for(int i=0;i<rows.length();i++)if("diagnostics".equals(rows.getJSONObject(i).optString("action")) && color.equals(rows.getJSONObject(i).optString("color")))diagnostic=rows.getJSONObject(i);
            assertNotNull(diagnostic);JSONObject row=diagnostic;
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{
                View view=OwnerWidgetService.rowView(context,row,103).apply(context,new FrameLayout(context));
                TextView glyph=view.findViewById(R.id.widget_row_glyph),title=view.findViewById(R.id.widget_row_title),detail=view.findViewById(R.id.widget_row_detail);
                int background=((android.graphics.drawable.ColorDrawable)view.getBackground()).getColor();
                // Status is carried by a distinct glyph shape plus color, and spoken in the row description.
                assertEquals("red".equals(color)?"✕":"green".equals(color)?"✓":"!",glyph.getText().toString());
                assertEquals(OwnerWidgetProvider.color(color,"light".equals(theme)),glyph.getCurrentTextColor());
                assertTrue(view.getContentDescription().toString().startsWith(WidgetRows.statusWord(color)));
                assertEquals("GitHub",title.getText().toString());
                assertTrue("Full detail stays available",view.getContentDescription().toString().contains("Check the integration connection."));
                assertEquals(1,detail.getMaxLines());
                assertTrue("Status glyph contrast "+theme+"/"+color,androidx.core.graphics.ColorUtils.calculateContrast(glyph.getCurrentTextColor(),background)>=4.5);
                assertTrue("Title text contrast "+theme,androidx.core.graphics.ColorUtils.calculateContrast(title.getCurrentTextColor(),background)>=4.5);
                assertTrue("Detail text contrast "+theme,androidx.core.graphics.ColorUtils.calculateContrast(detail.getCurrentTextColor(),background)>=4.5);
            }catch(Throwable error){failure.set(error);}});
            if(failure.get()!=null)throw new AssertionError(theme+"/"+color,failure.get());
        }
        JSONObject neutral=new JSONObject().put("title","Daily report").put("detail","48 intervals\nsecond line").put("action","report").put("color","");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{
            View view=OwnerWidgetService.rowView(context,neutral,103).apply(context,new FrameLayout(context));
            assertEquals("•",((TextView)view.findViewById(R.id.widget_row_glyph)).getText().toString());
            assertEquals("48 intervals · second line",((TextView)view.findViewById(R.id.widget_row_detail)).getText().toString());
            assertEquals(View.GONE,view.findViewById(R.id.widget_row_time).getVisibility());
        }catch(Throwable error){failure.set(error);}});
        if(failure.get()!=null)throw new AssertionError("neutral row",failure.get());
        CompanionSettings.remove(context,103);
    }
    private void captureHostedWidget(View view,String name) throws Exception {
        assertTrue(view.getWidth()>0 && view.getHeight()>0);
        Bitmap bitmap=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));
        File dir=context.getExternalFilesDir("widget-audit");if(dir!=null)dir.mkdirs();
        try(FileOutputStream output=new FileOutputStream(new File(dir,name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,output);}finally{bitmap.recycle();}
    }
    private View textContaining(View view, String text) {
        if (view instanceof TextView && ((TextView)view).getText().toString().contains(text)) return view;
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) {
            View found=textContaining(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;
        }
        return null;
    }
    private View textView(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView)view).getText())) return view;
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) {
            View found=textView(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;
        }
        return null;
    }
    @Test public void companionIsDiscoverableAndConfiguresThroughFrameworkWithoutAccount() throws Exception {
        assertEquals("1",shell("getprop ro.kernel.qemu"));
        WidgetStore.clear(context,null);
        // Record the one-time legacy-default check as already done so the new instances below are "new".
        CompanionSettings.preserveLegacyDefaults(context,new int[0],false);
        android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(context);
        android.content.ComponentName component=new android.content.ComponentName(context,CompanionWidgetProvider.class);
        android.appwidget.AppWidgetProviderInfo info=null;
        int providers=0;
        for(android.appwidget.AppWidgetProviderInfo candidate:manager.getInstalledProviders()) {
            if(context.getPackageName().equals(candidate.provider.getPackageName()))providers++;
            if(component.equals(candidate.provider))info=candidate;
        }
        assertEquals("Android must discover both independent widget providers",2,providers);
        assertNotNull("Companion must be installed before any account activity opens",info);
        assertEquals("Lootsplit 4×1 companion",info.loadLabel(context.getPackageManager()));
        assertEquals(android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN,info.widgetCategory);
        if(android.os.Build.VERSION.SDK_INT>=28)assertEquals(0,info.widgetFeatures & android.appwidget.AppWidgetProviderInfo.WIDGET_FEATURE_HIDE_FROM_PICKER);
        if(android.os.Build.VERSION.SDK_INT>=31){assertEquals(4,info.targetCellWidth);assertEquals(1,info.targetCellHeight);}
        assertNotNull(info.configure);
        shell("appwidget grantbind --package "+context.getPackageName()+" --user 0");
        android.appwidget.AppWidgetHost host=new android.appwidget.AppWidgetHost(context,197410);
        int id=host.allocateAppWidgetId(),second=host.allocateAppWidgetId();
        WidgetAuditActivity activity=null;
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        android.app.Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(CompanionWidgetConfigureActivity.class.getName(),null,false);
        CompanionWidgetConfigureActivity configuration=null;
        try {
            assertTrue(manager.bindAppWidgetIdIfAllowed(id,component));
            assertTrue(manager.bindAppWidgetIdIfAllowed(second,component));
            activity=(WidgetAuditActivity)instrumentation.startActivitySync(new android.content.Intent(context,WidgetAuditActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            WidgetAuditActivity screen=activity;
            instrumentation.runOnMainSync(()->host.startAppWidgetConfigureActivityForResult(screen,id,0,901,null));
            configuration=(CompanionWidgetConfigureActivity)monitor.waitForActivityWithTimeout(5000);
            assertNotNull("Launcher configuration must open for the bound companion",configuration);
            instrumentation.waitForIdleSync();
            CompanionWidgetConfigureActivity settings=configuration;
            instrumentation.runOnMainSync(()->{
                // A new companion opens on the Agent activity default; every earlier preset is still listed.
                assertEquals(CompanionSettings.DEFAULT_PRESET,settings.choices.get("preset").getSelectedItem().toString());
                assertEquals("activity",settings.choices.get("first").getSelectedItem().toString());
                settings.choices.get("preset").setSelection(java.util.Arrays.asList(CompanionSettings.PRESETS).indexOf("Server Health"));
            });
            instrumentation.waitForIdleSync();
            instrumentation.runOnMainSync(()->assertTrue(textView(settings.getWindow().getDecorView(),"Apply preset").performClick()));
            instrumentation.waitForIdleSync();
            androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("Save widget"))
                .perform(androidx.test.espresso.action.ViewActions.scrollTo(),androidx.test.espresso.action.ViewActions.click());
            long deadline=android.os.SystemClock.elapsedRealtime()+5000;
            while(screen.configurationResult==Integer.MIN_VALUE&&android.os.SystemClock.elapsedRealtime()<deadline)android.os.SystemClock.sleep(20);
            assertEquals(android.app.Activity.RESULT_OK,screen.configurationResult);
            assertEquals(id,screen.configuredWidget);
            assertEquals("health",CompanionSettings.read(context,id).getString("first"));
            assertEquals("A fresh, unconfigured companion uses Agent activity","activity",CompanionSettings.read(context,second).getString("first"));
            assertTrue("Adding/configuring must not create authorization",WidgetStore.read(context).optString("token").isEmpty());
            String preserved=WidgetStore.connect(context,"synthetic-registration-preservation");
            if(android.os.Build.VERSION.SDK_INT>=28) {
                manager.updateAppWidgetProviderInfo(component,"lootsplit.audit.stale-provider");
                assertNotEquals(0,manager.getAppWidgetInfo(id).widgetFeatures & android.appwidget.AppWidgetProviderInfo.WIDGET_FEATURE_HIDE_FROM_PICKER);
            }
            assertTrue("Upgrade registration refresh succeeds",WidgetRegistration.refresh(context,true));
            assertEquals("Both placed companion IDs survive registration refresh",2,manager.getAppWidgetIds(component).length);
            assertEquals("Instance preferences survive", "health",CompanionSettings.read(context,id).getString("first"));
            assertEquals("Owner connection survives metadata refresh",preserved,WidgetStore.read(context).getString("generation"));
            WidgetStore.clear(context,null);
            if(android.os.Build.VERSION.SDK_INT>=28)assertEquals(0,manager.getAppWidgetInfo(id).widgetFeatures & android.appwidget.AppWidgetProviderInfo.WIDGET_FEATURE_HIDE_FROM_PICKER);
            AtomicReference<android.appwidget.AppWidgetHostView> hosted=new AtomicReference<>();
            instrumentation.runOnMainSync(()->{
                host.startListening();android.appwidget.AppWidgetHostView view=host.createView(screen,id,manager.getAppWidgetInfo(id));
                android.graphics.Rect padding=android.appwidget.AppWidgetHostView.getDefaultPaddingForWidget(context,component,null);
                int height=Math.round(56*context.getResources().getDisplayMetrics().density)+padding.top+padding.bottom;
                screen.setContentView(view,new ViewGroup.LayoutParams(-1,height));hosted.set(view);CompanionWidgetProvider.renderAll(context);
            });
            AtomicReference<String> identity=new AtomicReference<>("");deadline=android.os.SystemClock.elapsedRealtime()+5000;
            while(android.os.SystemClock.elapsedRealtime()<deadline){
                instrumentation.runOnMainSync(()->{TextView text=hosted.get().findViewById(R.id.companion_first);identity.set(text==null||text.getContentDescription()==null?"":text.getText()+"|"+text.getContentDescription());});
                if(identity.get().startsWith("Owner sign-in needed|OWNER · SIGN IN"))break;android.os.SystemClock.sleep(20);
            }
            assertTrue(identity.get(),identity.get().startsWith("Owner sign-in needed|OWNER · SIGN IN"));
            AtomicReference<String> signedOutGlyph=new AtomicReference<>("");
            instrumentation.runOnMainSync(()->signedOutGlyph.set(((TextView)hosted.get().findViewById(R.id.companion_light)).getText().toString()));
            assertEquals("Signed-out glyph is a neutral dash, never ?","–",signedOutGlyph.get());
            AtomicReference<Throwable> failure=new AtomicReference<>();
            instrumentation.runOnMainSync(()->{try{captureHostedWidget(hosted.get(),"hosted-companion-signed-out");}catch(Throwable e){failure.set(e);}});
            if(failure.get()!=null)throw new AssertionError("Companion framework capture",failure.get());
            assertTrue("Adding/configuring must not create account authorization",WidgetStore.read(context).optString("token").isEmpty());
        } finally {
            if(configuration!=null){CompanionWidgetConfigureActivity settings=configuration;instrumentation.runOnMainSync(settings::finish);}
            if(activity!=null){WidgetAuditActivity screen=activity;instrumentation.runOnMainSync(screen::finish);}
            instrumentation.waitForIdleSync();instrumentation.removeMonitor(monitor);
            host.stopListening();host.deleteHost();CompanionSettings.remove(context,id);CompanionSettings.remove(context,second);
            shell("appwidget revokebind --package "+context.getPackageName()+" --user 0");
        }
    }
    @Test public void actualFrameworkHostScrollsCollectionAndClearsRevokedRows() throws Exception {
        assertEquals("1",shell("getprop ro.kernel.qemu"));
        shell("appwidget grantbind --package "+context.getPackageName()+" --user 0");
        String generation=WidgetStore.connect(context,"synthetic-host");WidgetStore.finish(context,generation,WidgetData.project(journalFixture(),System.currentTimeMillis()),"");
        android.appwidget.AppWidgetHost host=new android.appwidget.AppWidgetHost(context,197409);
        android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(context);
        int id=host.allocateAppWidgetId();
        WidgetAuditActivity activity=null;
        try {
            assertTrue(manager.bindAppWidgetIdIfAllowed(id,new android.content.ComponentName(context,OwnerWidgetProvider.class)));
            activity=(WidgetAuditActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new android.content.Intent(context,WidgetAuditActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            WidgetAuditActivity screen=activity;AtomicReference<android.appwidget.AppWidgetHostView> hosted=new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
                host.startListening();android.appwidget.AppWidgetHostView view=host.createView(screen,id,manager.getAppWidgetInfo(id));
                float density=context.getResources().getDisplayMetrics().density;
                screen.setContentView(view,new ViewGroup.LayoutParams(Math.round(350*density),Math.round(400*density)));hosted.set(view);
                OwnerWidgetProvider.renderAll(context);
            });
            long deadline=android.os.SystemClock.elapsedRealtime()+8000;AtomicInteger count=new AtomicInteger();
            while(android.os.SystemClock.elapsedRealtime()<deadline){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{android.widget.ListView list=hosted.get().findViewById(R.id.monitor_list);count.set(list==null?0:list.getCount());});if(count.get()>8)break;android.os.SystemClock.sleep(100);}
            assertTrue("Actual AppWidgetHost receives the collection",count.get()>8);
            AtomicReference<Throwable> captureFailure=new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{captureHostedWidget(hosted.get(),"hosted-main-terminal");}catch(Throwable error){captureFailure.set(error);}});
            if(captureFailure.get()!=null)throw new AssertionError("Hosted screenshot",captureFailure.get());
            AtomicInteger first=new AtomicInteger();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{android.widget.ListView list=hosted.get().findViewById(R.id.monitor_list);list.setSelection(list.getCount()-1);});
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{android.widget.ListView list=hosted.get().findViewById(R.id.monitor_list);first.set(list.getFirstVisiblePosition());});assertTrue(first.get()>0);
            CompanionSettings.save(context,id,CompanionSettings.preset("Development").put("theme","light"));
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            AtomicInteger lightRows=new AtomicInteger();deadline=android.os.SystemClock.elapsedRealtime()+5000;
            while(android.os.SystemClock.elapsedRealtime()<deadline){
                InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
                    android.widget.ListView list=hosted.get().findViewById(R.id.monitor_list);View child=list==null?null:list.getChildAt(0);View row=child==null?null:child.findViewById(R.id.widget_row);
                    if(row!=null && row.getBackground() instanceof android.graphics.drawable.ColorDrawable && ((android.graphics.drawable.ColorDrawable)row.getBackground()).getColor()==android.graphics.Color.rgb(247,242,228))lightRows.set(1);
                });
                if(lightRows.get()==1)break;android.os.SystemClock.sleep(20);
            }
            assertEquals("Actual collection follows the light theme",1,lightRows.get());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{captureHostedWidget(hosted.get(),"hosted-main-light");}catch(Throwable error){captureFailure.set(error);}});
            if(captureFailure.get()!=null)throw new AssertionError("Light hosted screenshot",captureFailure.get());
            WidgetStore.revoke(context,generation,"Owner authorization rejected. Sign in again.");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            deadline=android.os.SystemClock.elapsedRealtime()+5000;
            while(android.os.SystemClock.elapsedRealtime()<deadline){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{android.widget.ListView list=hosted.get().findViewById(R.id.monitor_list);count.set(list==null?0:list.getCount());});if(count.get()==1)break;android.os.SystemClock.sleep(100);}
            assertEquals(1,count.get());
        }finally{
            if(activity!=null){WidgetAuditActivity screen=activity;InstrumentationRegistry.getInstrumentation().runOnMainSync(screen::finish);InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
            host.stopListening();host.deleteHost();CompanionSettings.remove(context,id);shell("appwidget revokebind --package "+context.getPackageName()+" --user 0");
        }
    }

    private View mainFace(JSONObject snapshot) throws Exception {
        JSONObject state=new JSONObject().put("token","synthetic").put("snapshot",snapshot);
        AtomicReference<View> out=new AtomicReference<>();AtomicReference<Throwable> failure=new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{
            float density=context.getResources().getDisplayMetrics().density;FrameLayout parent=new FrameLayout(context);
            View view=OwnerWidgetProvider.views(context,state,true).apply(context,parent);parent.addView(view);
            int w=Math.round(350*density),h=Math.round(480*density);
            parent.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));parent.layout(0,0,w,h);bounds(view);out.set(view);
        }catch(Throwable error){failure.set(error);}});
        if(failure.get()!=null)throw new AssertionError("main face",failure.get());
        return out.get();
    }
    private String text(View view,int id){ return ((TextView)view.findViewById(id)).getText().toString(); }
    @Test public void healthyReadingStaysGreenUntilThirtyFiveMinutes() throws Exception {
        long now=System.currentTimeMillis();
        JSONObject source=journalFixture();
        source.put("overall",new JSONObject().put("color","green").put("status","healthy").put("reason","All required checks passed."));
        for(int i=0;i<source.getJSONArray("diagnostics").length();i++)source.getJSONArray("diagnostics").getJSONObject(i).put("color","green");
        JSONObject snapshot=WidgetData.project(source,now);
        assertEquals(35L*60000,OwnerWidgetProvider.STALE_AFTER_MILLIS);
        // A reading from the previous ~30-minute background refresh is still healthy (was amber after 2 minutes).
        snapshot.put("checkedAt",now-31*60000L);
        assertEquals("green",OwnerWidgetProvider.statusColor(snapshot,now));
        assertEquals("HEALTHY",WidgetRows.status(snapshot));
        snapshot.put("checkedAt",now-OwnerWidgetProvider.STALE_AFTER_MILLIS);
        assertEquals("Exactly at the threshold is still fresh","green",OwnerWidgetProvider.statusColor(snapshot,now));
        snapshot.put("checkedAt",now-36*60000L);
        assertEquals("A missed refresh turns the healthy reading amber","yellow",OwnerWidgetProvider.statusColor(snapshot,now));
        assertEquals("HEALTHY AT LAST CHECK",WidgetRows.status(snapshot));
        // A confirmed failure stays red however old it is; readings over one hour are still hidden.
        snapshot.put("statusColor","red");
        assertEquals("red",OwnerWidgetProvider.statusColor(snapshot,now));
        snapshot.put("checkedAt",now-3600001L);
        assertNull(OwnerWidgetProvider.current(new JSONObject().put("token","synthetic").put("snapshot",snapshot)));
    }
    @Test public void mainFaceGlyphsReasonStatsAndAttentionOrdering() throws Exception {
        java.util.Set<String> glyphs=new java.util.HashSet<>();
        for(String color:new String[]{"green","yellow","red"}) {
            JSONObject source=journalFixture();
            source.put("overall",new JSONObject().put("color",color).put("reason","green".equals(color)?"All required checks passed.":"GitHub"));
            source.getJSONArray("diagnostics").getJSONObject(0).put("color",color);
            JSONObject snapshot=WidgetData.project(source,System.currentTimeMillis());
            View view=mainFace(snapshot);
            String glyph=text(view,R.id.monitor_glyph);glyphs.add(glyph);
            assertEquals("red".equals(color)?"✕":"green".equals(color)?"✓":"!",glyph);
            assertEquals("red".equals(color)?"FAILURE":"green".equals(color)?"HEALTHY":"UNVERIFIED",text(view,R.id.monitor_health));
            assertEquals(OwnerWidgetProvider.color(color,false),((TextView)view.findViewById(R.id.monitor_health)).getCurrentTextColor());
            if(!"green".equals(color)) {
                assertEquals("Single component names itself with its symptom","GitHub · The source did not respond.",text(view,R.id.monitor_services));
                assertEquals("NEEDS ATTENTION FIRST",text(view,R.id.monitor_list_label));
                assertEquals(color,WidgetRows.rows(snapshot).getJSONObject(0).getString("color"));
            } else assertEquals("LOG",text(view,R.id.monitor_list_label));
            assertEquals("12",text(view,R.id.monitor_active));assertEquals("128",text(view,R.id.monitor_accounts));assertEquals("24",text(view,R.id.monitor_campaigns));
            assertEquals("Traffic not connected stays unavailable, never 0","—",text(view,R.id.monitor_requests));
            assertEquals("OWNER · Test Owner · #42",text(view,R.id.monitor_identity));
            assertTrue(text(view,R.id.monitor_development).startsWith("▶ TESTING"));
            assertEquals(View.VISIBLE,view.findViewById(R.id.monitor_timer).getVisibility());
        }
        assertEquals("Glyph shapes differ per state, not only color",3,glyphs.size());
        // Several components: a count on the face, the full list kept in the description and rows.
        JSONObject source=journalFixture();
        source.put("overall",new JSONObject().put("color","red").put("reason","Database, Worker errors, GitHub"));
        source.put("traffic",new JSONObject().put("state","ready").put("data",new JSONObject().put("requests",11734).put("errors",42)));
        JSONObject snapshot=WidgetData.project(source,System.currentTimeMillis());
        View view=mainFace(snapshot);
        assertEquals("3 checks failed · tap for details",text(view,R.id.monitor_services));
        assertTrue(view.findViewById(R.id.monitor_services).getContentDescription().toString().contains("Database, Worker errors, GitHub"));
        assertEquals("11.7k",text(view,R.id.monitor_requests));
        assertEquals("REQ · 42 ERR",text(view,R.id.monitor_requests_label));
        assertEquals("Request tile turns red when errors exist",OwnerWidgetProvider.color("red",false),((TextView)view.findViewById(R.id.monitor_requests)).getCurrentTextColor());
        // Every row is kept when attention rows move first.
        source.put("diagnostics",new org.json.JSONArray().put(new JSONObject().put("component","Database").put("color","green").put("symptom","Responding").put("action","None"))
            .put(new JSONObject().put("component","Worker errors").put("color","red").put("symptom","42 errors").put("action","Review deployment")));
        snapshot=WidgetData.project(source,System.currentTimeMillis());
        org.json.JSONArray rows=WidgetRows.rows(snapshot);
        assertEquals("Worker errors",rows.getJSONObject(0).getString("title"));
        int diagnostics=0;for(int i=0;i<rows.length();i++)if("diagnostics".equals(rows.getJSONObject(i).optString("action"))&&!rows.getJSONObject(i).optString("color").isEmpty())diagnostics++;
        assertEquals(2,diagnostics);
        assertEquals("Other rows keep their original order","Development",rows.getJSONObject(1).getString("title"));
        assertEquals(WidgetRows.rows(WidgetData.project(source.put("diagnostics",new org.json.JSONArray()),System.currentTimeMillis())).length()+2,rows.length());
        // Missing statistics render as "—" on every tile, never 0.
        JSONObject missing=journalFixture();missing.getJSONObject("health").remove("stats");
        view=mainFace(WidgetData.project(missing,System.currentTimeMillis()));
        for(int id:new int[]{R.id.monitor_active,R.id.monitor_accounts,R.id.monitor_campaigns,R.id.monitor_requests})assertEquals("—",text(view,id));
    }

    private static JSONObject usagePart(long value,double share,double percent) throws Exception {
        return new JSONObject().put("value",value).put("share",share).put("percent",percent);
    }
    @Test public void cloudflareUsageRowsShowValueAndShareAndKeepGapsExplicit() throws Exception {
        long now=System.currentTimeMillis();
        org.json.JSONArray metrics=new org.json.JSONArray()
            .put(new JSONObject().put("key","requests").put("label","Worker requests").put("unit","count").put("state","ready").put("level","ok").put("monthlyAllowance",10000000L)
                .put("day",usagePart(12345,322580.645,3.827)).put("week",usagePart(80000,2258064.516,3.543)).put("month",usagePart(300000,10000000,3)))
            .put(new JSONObject().put("key","cpuMs").put("label","Worker CPU time").put("unit","ms").put("state","unavailable").put("errorCode","HTTP_400").put("level","unavailable"))
            .put(new JSONObject().put("key","d1RowsRead").put("label","D1 rows read").put("unit","count").put("state","ready").put("level","attention").put("monthlyAllowance",25000000000L)
                .put("day",usagePart(1000,806451612.9,0.0001)).put("week",usagePart(7000,5645161290.3,0.0001)).put("month",usagePart(21000000000L,25000000000L,84)))
            .put(new JSONObject().put("key","d1StorageBytes").put("label","D1 storage").put("unit","bytes").put("state","ready").put("level","ok").put("allowance",5000000000L)
                .put("current",new JSONObject().put("value",12000000L).put("allowance",5000000000L).put("percent",0.24)).put("databases",1));
        JSONObject source=journalFixture();
        source.put("usage",new JSONObject().put("state","ready").put("checkedAt",now)
            .put("data",new JSONObject().put("metrics",metrics).put("windows",new JSONObject().put("month",new JSONObject().put("elapsedPercent",69.355)))));
        org.json.JSONArray rows=WidgetRows.rows(WidgetData.project(source,now));
        java.util.Map<String,JSONObject> byTitle=new java.util.HashMap<>();
        for(int i=0;i<rows.length();i++)byTitle.put(rows.getJSONObject(i).getString("title"),rows.getJSONObject(i));
        JSONObject requests=byTitle.get("Worker requests today 12,345");
        assertNotNull("Value in the title",requests);
        assertTrue(requests.getString("detail").startsWith("3.8% of daily share\n7d 80,000 (3.5% of weekly share)\nMonth 300,000 (3.0% of 10M)"));
        assertEquals("",requests.getString("color"));
        assertEquals("Month to date at 80% or more is amber","yellow",byTitle.get("D1 rows read today 1,000").getString("color"));
        assertTrue(byTitle.get("D1 rows read today 1,000").getString("detail").startsWith("<0.01% of daily share"));
        assertTrue("A failed metric is not zero",byTitle.get("Worker CPU time · unavailable").getString("detail").contains("not counted as zero"));
        assertTrue(byTitle.get("D1 storage 12.0 MB").getString("detail").startsWith("0.24% of 5 GB included"));
        assertTrue(byTitle.get("Cloudflare plan usage").getString("detail").contains("69% of month elapsed"));
        // Missing, stale or disconnected readings are one explicit row, without numbers.
        for(String[] c:new String[][]{{"not-connected","","not connected"},{"unavailable","STALE_READING","over 2 hours old"},{"unavailable","NOT_COLLECTED","first hourly reading pending"}}) {
            source.put("usage",new JSONObject().put("state",c[0]).put("errorCode",c[1]).put("checkedAt",now).put("data",JSONObject.NULL));
            rows=WidgetRows.rows(WidgetData.project(source,now));
            int usageRows=0;String detail="";
            for(int i=0;i<rows.length();i++){String title=rows.getJSONObject(i).getString("title");if(title.startsWith("Cloudflare plan usage")){usageRows++;detail=rows.getJSONObject(i).getString("detail");}if(title.contains(" today "))fail("No metric rows without a reading");}
            assertEquals(1,usageRows);assertTrue(detail,detail.contains(c[2]));
        }
        source.remove("usage");
        rows=WidgetRows.rows(WidgetData.project(source,now));
        boolean older=false;for(int i=0;i<rows.length();i++)older|=rows.getJSONObject(i).getString("detail").contains("not provided by server");
        assertTrue("An older server states the gap",older);
    }
    private JSONObject activityEvent(String kind,String state,String text,String title,int pr,double minutesAgo) throws Exception {
        return new JSONObject().put("id",kind+pr).put("kind",kind).put("state",state).put("text",text).put("title",title).put("pr",pr)
            .put("at",System.currentTimeMillis()-(long)(minutesAgo*60000)).put("url","https://github.com/UnregisteredMusket/Lootsplit/pull/"+pr);
    }
    private JSONObject activityFixture(org.json.JSONArray events,int active) throws Exception {
        JSONObject source=journalFixture();
        source.getJSONObject("development").put("checkedAt",System.currentTimeMillis()).getJSONObject("data").put("events",events).put("activeActivity",active);
        return source;
    }
    private JSONObject activityState(JSONObject source,String message) throws Exception {
        return new JSONObject().put("token","synthetic").put("message",message).put("snapshot",WidgetData.project(source,System.currentTimeMillis()));
    }
    @Test public void agentActivityPresetIsDefaultAndEarlierPresetsAndSettingsStay() throws Exception {
        java.util.List<String> presets=java.util.Arrays.asList(CompanionSettings.PRESETS);
        assertEquals("Agent activity",presets.get(0));assertEquals("Agent activity",CompanionSettings.DEFAULT_PRESET);
        for(String kept:new String[]{"Development","Server Health","Analytics","Quick Actions"})assertTrue(kept+" remains selectable",presets.contains(kept));
        for(String category:new String[]{"health","analytics","traffic","task","timer","log","warning","report","activity"})assertTrue(category,java.util.Arrays.asList(CompanionSettings.CATEGORIES).contains(category));
        CompanionSettings.remove(context,104);
        assertEquals("activity",CompanionSettings.read(context,104).getString("first"));
        assertEquals("activity",CompanionSettings.read(context,104).getString("second"));
        assertEquals("refresh",CompanionSettings.read(context,104).getString("action1"));
        // Saved settings are never rewritten.
        CompanionSettings.save(context,104,CompanionSettings.preset("Analytics").put("theme","light"));
        assertEquals("analytics",CompanionSettings.read(context,104).getString("first"));
        // Upgrade: companions already placed without saved settings keep the earlier Development default.
        android.content.SharedPreferences presentation=context.getSharedPreferences("widget-presentation",Context.MODE_PRIVATE);
        presentation.edit().remove("defaults-v2").remove("instance-105").commit();
        CompanionSettings.preserveLegacyDefaults(context,new int[]{104,105},true);
        assertEquals("task",CompanionSettings.read(context,105).getString("first"));
        assertEquals("timer",CompanionSettings.read(context,105).getString("second"));
        assertEquals("Saved choices are untouched","analytics",CompanionSettings.read(context,104).getString("first"));
        CompanionSettings.remove(context,105);
        CompanionSettings.preserveLegacyDefaults(context,new int[]{105},true);
        assertEquals("The check runs once; later companions are new","activity",CompanionSettings.read(context,105).getString("first"));
        // Fresh install: nothing to preserve.
        presentation.edit().remove("defaults-v2").commit();
        CompanionSettings.preserveLegacyDefaults(context,new int[]{105},false);
        assertEquals("activity",CompanionSettings.read(context,105).getString("first"));
        CompanionSettings.remove(context,104);CompanionSettings.remove(context,105);
    }
    @Test public void agentActivityCompanionShowsGlyphTextAgeAndExplicitUnavailableState() throws Exception {
        JSONObject preset=CompanionSettings.preset("Agent activity");
        org.json.JSONArray events=new org.json.JSONArray()
            .put(activityEvent("pr-merged","ok","Merged #138","Widget redesign",138,2))
            .put(activityEvent("pr-opened","ok","Opened #140","Agent activity",140,3))
            .put(activityEvent("run-started","active","Verify running on #138","Widget redesign",138,4));
        for(String theme:new String[]{"terminal","light"}) {
            View view=renderCompanion(activityState(activityFixture(events,1),""),new JSONObject(preset.toString()).put("theme",theme),250,56,"companion-agent-activity-merged-"+theme);
            assertEquals("✓",text(view,R.id.companion_light));
            assertEquals("Merged #138 · Widget redesign · 2m",text(view,R.id.companion_first));
            assertEquals("The running workflow is the next most relevant item","! Verify running on #138 · 4m",text(view,R.id.companion_second));
            assertTrue(view.findViewById(R.id.companion_first).getContentDescription().toString().contains("GitHub activity"));
            assertTrue(view.findViewById(R.id.companion_first).hasOnClickListeners());
            assertTrue(view.findViewById(R.id.companion_second).hasOnClickListeners());
            assertTrue(view.findViewById(R.id.companion_light).hasOnClickListeners());
        }
        org.json.JSONArray failed=new org.json.JSONArray().put(activityEvent("run-failed","fail","Verify failed on #138","Widget redesign",138,1)).put(activityEvent("pr-merged","ok","Merged #137","Icons",137,30));
        View view=renderCompanion(activityState(activityFixture(failed,0),""),preset,350,72,"companion-agent-activity-failed");
        assertEquals("✕",text(view,R.id.companion_light));
        // Nothing is running, so the face is not re-rendered every minute: clock times, not ages that would go stale.
        assertEquals("Verify failed on #138 · "+WidgetRows.clock(failed.getJSONObject(0).getLong("at")),text(view,R.id.companion_first));
        assertEquals("✓ Merged #137 · Icons · "+WidgetRows.clock(failed.getJSONObject(1).getLong("at")),text(view,R.id.companion_second));
        org.json.JSONArray running=new org.json.JSONArray().put(activityEvent("run-started","active","Verify running on #138","",138,4));
        view=renderCompanion(activityState(activityFixture(running,1),""),preset,350,72,"companion-agent-activity-running");
        assertEquals("!",text(view,R.id.companion_light));
        assertEquals("Verify running on #138 · 4m",text(view,R.id.companion_first));
        assertTrue(text(view,R.id.companion_second).startsWith("GitHub activity · checked "));
        // A successful empty read is real; an unavailable source is never shown as "no activity".
        view=renderCompanion(activityState(activityFixture(new org.json.JSONArray(),0),""),preset,350,72,"companion-agent-activity-empty");
        assertEquals("–",text(view,R.id.companion_light));assertEquals("No recent GitHub activity",text(view,R.id.companion_first));
        String[][] unavailable={{"HTTP_403_RATE_LIMITED","rate limited"},{"HTTP_401","access denied"},{"SOURCE_TIMEOUT","timed out"}};
        for(String[] item:unavailable) {
            JSONObject source=journalFixture();
            source.put("development",new JSONObject().put("state","unavailable").put("checkedAt",System.currentTimeMillis()).put("data",JSONObject.NULL).put("errorCode",item[0]));
            view=renderCompanion(activityState(source,""),preset,250,56,"companion-agent-activity-unavailable-"+item[1].replace(" ","-"));
            assertEquals("!",text(view,R.id.companion_light));
            assertEquals("GitHub activity unavailable · "+item[1],text(view,R.id.companion_first));
            assertFalse(text(view,R.id.companion_first).contains("No recent"));
        }
        JSONObject disconnected=journalFixture();disconnected.put("development",new JSONObject().put("state","not-connected").put("data",JSONObject.NULL));
        view=renderCompanion(activityState(disconnected,""),preset,250,56,"companion-agent-activity-not-connected");
        assertEquals("GitHub activity not connected",text(view,R.id.companion_first));
        // A server without events (older Worker) is unavailable, not empty.
        view=renderCompanion(activityState(journalFixture(),""),preset,250,56,"companion-agent-activity-no-events");
        assertEquals("GitHub activity unavailable · not provided by server",text(view,R.id.companion_first));
        // A failed refresh keeps the dated reading and says so.
        view=renderCompanion(activityState(activityFixture(events,1),"Could not refresh · tap Refresh to retry"),preset,350,72,"companion-agent-activity-refresh-failed");
        assertEquals("Merged #138 · Widget redesign · 2m",text(view,R.id.companion_first));
        assertTrue(text(view,R.id.companion_second).startsWith("Could not refresh · tap Refresh to retry · as of "));
        // Signed out stays the existing sign-in state.
        view=renderCompanion(new JSONObject().put("message","Connect in My account"),preset,250,56,"companion-agent-activity-signed-out");
        assertEquals("–",text(view,R.id.companion_light));assertEquals("Owner sign-in needed",text(view,R.id.companion_first));
        assertEquals("field-development",WidgetActions.destination("activity"));
    }
    /** The owner's production reading of 2026-10-22: one old Worker error, Multiplayer's by-design gap, an ended step. */
    private JSONObject productionFixture(long errorAt) throws Exception {
        JSONObject source=journalFixture(); long now=System.currentTimeMillis();
        source.put("overall",new JSONObject().put("color","yellow").put("status","attention").put("label","Recent problem needs review; current checks pass")
                .put("reason","Worker execution errors").put("notes",new org.json.JSONArray().put("Multiplayer")))
            .put("traffic",new JSONObject().put("state","ready").put("checkedAt",now).put("data",new JSONObject().put("requests",23674).put("errors",1)))
            .put("diagnostics",new org.json.JSONArray()
                .put(new JSONObject().put("component","Storage").put("color","green").put("state","healthy").put("symptom","Database responded in 4 ms.").put("action","No action required."))
                .put(new JSONObject().put("component","Multiplayer").put("color","yellow").put("state","unavailable").put("required",false).put("coverageLimit",true)
                    .put("brief","not measured by design").put("symptom","Storage was checked; no synthetic player session was created.").put("action","Check the existing room connection indicator."))
                .put(new JSONObject().put("component","Worker execution errors").put("color","yellow").put("state","warning").put("brief","1 error in 24h").put("lastAt",errorAt)
                    .put("symptom","1 Worker error(s) were reported in the measured past-24-hour window. None since.").put("action","Inspect Cloudflare invocation logs.")))
            .put("developmentStatus",new JSONObject().put("label","No development task active").put("warning",JSONObject.NULL).put("task",new JSONObject()
                .put("id","run:1:1:deploy:website-live-audit").put("revision",4).put("title","website-live-audit").put("objective","Live audit").put("phase","website-live-audit")
                .put("progress","Runner result: success.").put("state","completed").put("active",false).put("startedAt",now-3600000).put("heartbeatAt",now-600000).put("progressAt",now-600000).put("completedAt",now-600000)));
        return source;
    }
    @Test public void attentionCoverageLimitsRecentErrorsAndLastTaskAreDistinct() throws Exception {
        long errorAt=System.currentTimeMillis()-2*3600000L;
        JSONObject snapshot=WidgetData.project(productionFixture(errorAt),System.currentTimeMillis());
        assertEquals("attention",snapshot.getString("statusKind"));
        View view=mainFace(snapshot);
        assertEquals("!",text(view,R.id.monitor_glyph));
        assertEquals("A recent error that stopped is attention, not a failure","ATTENTION",text(view,R.id.monitor_health));
        assertEquals("Worker execution errors · 1 error in 24h · last "+WidgetRows.clock(errorAt),text(view,R.id.monitor_services));
        // The error tile is amber, not red, and the count is unchanged.
        assertEquals("REQ · 1 ERR",text(view,R.id.monitor_requests_label));
        assertEquals(OwnerWidgetProvider.color("yellow",false),((TextView)view.findViewById(R.id.monitor_requests_label)).getCurrentTextColor());
        assertNotEquals(OwnerWidgetProvider.color("red",false),((TextView)view.findViewById(R.id.monitor_requests)).getCurrentTextColor());
        assertTrue(view.findViewById(R.id.monitor_requests).getContentDescription().toString().contains("errors: 1, none in the latest half-hour"));
        // Idle task card names the last task and how it ended instead of a bare "no task".
        assertEquals("No development task active",text(view,R.id.monitor_development));
        assertEquals(View.VISIBLE,view.findViewById(R.id.monitor_task_detail).getVisibility());
        assertTrue(text(view,R.id.monitor_task_detail),text(view,R.id.monitor_task_detail).startsWith("Last: website-live-audit · completed "));
        // Rows: the recent error first; Multiplayer kept, as information, never as attention.
        org.json.JSONArray rows=WidgetRows.rows(snapshot);
        assertEquals("Worker execution errors",rows.getJSONObject(0).getString("title"));
        assertEquals("yellow",rows.getJSONObject(0).getString("color"));
        assertEquals(WidgetRows.clock(errorAt),rows.getJSONObject(0).getString("time"));
        assertEquals(1,WidgetRows.attention(rows));
        boolean limit=false;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(row.getString("title").equals("Multiplayer · coverage limit")){limit=true;assertEquals("",row.getString("color"));assertTrue(row.getString("detail").contains("no synthetic player session"));}}
        assertTrue("The coverage limit stays listed",limit);
        assertTrue(WidgetRows.rows(snapshot).getJSONObject(1).getString("detail").length()>0);
        // Healthy with the same coverage limit reads HEALTHY with a short note; the limit is named in the description.
        JSONObject healthySource=productionFixture(errorAt);
        healthySource.put("overall",new JSONObject().put("color","green").put("status","healthy").put("label","Required checks current and healthy")
            .put("reason","All required checks passed. Coverage limit noted (not a failure): Multiplayer.").put("notes",new org.json.JSONArray().put("Multiplayer")));
        healthySource.getJSONArray("diagnostics").getJSONObject(2).put("color","green").put("state","healthy").put("brief","0 errors in 24h").put("lastAt",0);
        healthySource.getJSONObject("traffic").getJSONObject("data").put("errors",0);
        JSONObject healthy=WidgetData.project(healthySource,System.currentTimeMillis());
        view=mainFace(healthy);
        assertEquals("✓",text(view,R.id.monitor_glyph));
        assertEquals("HEALTHY",text(view,R.id.monitor_health));
        assertEquals("All checks passed · 1 coverage limit",text(view,R.id.monitor_services));
        assertTrue(view.findViewById(R.id.monitor_services).getContentDescription().toString().contains("Multiplayer"));
        assertEquals("LOG",text(view,R.id.monitor_list_label));
        assertEquals("HEALTHY · all checks",WidgetRows.category(healthy,"health"));
        // A current Worker error keeps the red tile.
        JSONObject failing=productionFixture(errorAt);
        failing.put("overall",new JSONObject().put("color","red").put("status","failure").put("reason","Worker execution errors"));
        failing.getJSONArray("diagnostics").getJSONObject(2).put("color","red").put("state","error");
        view=mainFace(WidgetData.project(failing,System.currentTimeMillis()));
        assertEquals("FAILURE",text(view,R.id.monitor_health));
        assertEquals(OwnerWidgetProvider.color("red",false),((TextView)view.findViewById(R.id.monitor_requests)).getCurrentTextColor());
        // Older servers (colour only) and inconsistent statuses fall back to the colour.
        assertEquals("unverified",WidgetData.statusKind(new JSONObject().put("color","yellow")));
        assertEquals("failure",WidgetData.statusKind(new JSONObject().put("color","red").put("status","healthy")));
        assertEquals("healthy",WidgetData.statusKind(new JSONObject().put("color","green")));
        assertEquals("unverified",WidgetData.statusKind(null));
    }
    @Test public void compactPayloadAgesAndBackgroundRetryRules() throws Exception {
        assertTrue("Widgets request the compact view",WidgetClient.ENDPOINT.endsWith("/api/account/owner/monitor?view=widget"));
        // The compact view has no scanned runs; everything the widgets show still projects.
        JSONObject compact=journalFixture();
        compact.getJSONObject("development").getJSONObject("data").put("omitted",new JSONObject().put("runs",100).put("closedPulls",20));
        JSONObject snapshot=WidgetData.project(compact,System.currentTimeMillis());
        assertEquals("1 running · 1 open PRs",snapshot.getString("development"));
        assertEquals("Deploy: in_progress",snapshot.getString("deployment"));
        // Relative ages only while the fast cadence re-renders; otherwise the clock time.
        long now=System.currentTimeMillis();
        JSONObject event=activityEvent("pr-merged","ok","Merged #138","Widget redesign",138,2);
        assertEquals("Merged #138 · Widget redesign · 2m",WidgetRows.activityLine(event,now,true));
        assertEquals("Merged #138 · Widget redesign · "+WidgetRows.clock(event.getLong("at")),WidgetRows.activityLine(event,now,false));
        org.json.JSONArray events=new org.json.JSONArray().put(event);
        assertTrue(WidgetRows.activityLive(WidgetData.project(activityFixture(events,1),now),now));
        assertFalse(WidgetRows.activityLive(WidgetData.project(activityFixture(events,0),now),now));
        assertFalse(WidgetRows.activityLive(WidgetData.project(activityFixture(events,1),now),now+WidgetRefresh.ACTIVITY_MAX_AGE_MILLIS+60000));
        // Background retries with backoff only after transport failures.
        assertTrue(WidgetRefresh.transientFailure(WidgetRefresh.FAILED));
        assertTrue(WidgetRefresh.transientFailure(WidgetRefresh.TIMED_OUT));
        for(String final_:new String[]{"","Connect your owner account in My account.","Owner session expired. Sign in again in My account.","Account changed. Refresh the current account.","Widget storage unavailable. Reconnect in My account."})
            assertFalse(final_,WidgetRefresh.transientFailure(final_));
        String generation=WidgetStore.connect(context,"synthetic-backoff");
        assertNotNull(generation);
        context.getSystemService(JobScheduler.class).cancel(OwnerWidgetJob.ID);
        OwnerWidgetJob.schedule(context);
        android.app.job.JobInfo job=context.getSystemService(JobScheduler.class).getPendingJob(OwnerWidgetJob.ID);
        assertNotNull(job);
        assertEquals(android.app.job.JobInfo.BACKOFF_POLICY_EXPONENTIAL,job.getBackoffPolicy());
        assertEquals(60000,job.getInitialBackoffMillis());
        assertEquals(1800000,job.getIntervalMillis());
    }
    @Test public void agentActivityFastRefreshIsNonWakeupAndOnlyWhileActive() throws Exception {
        JSONObject[] activity={CompanionSettings.preset("Agent activity")},other={CompanionSettings.preset("Development"),CompanionSettings.preset("Server Health")};
        org.json.JSONArray events=new org.json.JSONArray().put(activityEvent("run-started","active","Verify running on #138","",138,1));
        JSONObject active=activityState(activityFixture(events,1),""),idle=activityState(activityFixture(events,0),"");
        long now=System.currentTimeMillis();
        assertTrue(WidgetRefresh.activityFast(active,activity,now));
        assertFalse("Only with an Agent activity companion",WidgetRefresh.activityFast(active,other,now));
        assertFalse("Nothing running",WidgetRefresh.activityFast(idle,activity,now));
        assertFalse("Signed out",WidgetRefresh.activityFast(new JSONObject().put("snapshot",active.getJSONObject("snapshot")),activity,now));
        assertFalse("Stale reading hands back to the periodic job",WidgetRefresh.activityFast(active,activity,now+WidgetRefresh.ACTIVITY_MAX_AGE_MILLIS+1));
        JSONObject broken=journalFixture();broken.put("development",new JSONObject().put("state","unavailable").put("errorCode","HTTP_403_RATE_LIMITED"));
        assertFalse("Unavailable GitHub never polls fast",WidgetRefresh.activityFast(activityState(broken,""),activity,now));
        // Through the real provider lifecycle with a placed companion.
        assertEquals("1",shell("getprop ro.kernel.qemu"));
        shell("appwidget grantbind --package "+context.getPackageName()+" --user 0");
        android.appwidget.AppWidgetHost host=new android.appwidget.AppWidgetHost(context,197411);
        android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(context);
        int id=host.allocateAppWidgetId();
        java.util.List<String> calls=java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        WidgetRefresh.alarm=new WidgetRefresh.ActivityAlarm(){
            @Override public void set(Context c,int type,long at,android.app.PendingIntent tick){calls.add("set:"+type+":"+(at-System.currentTimeMillis()));}
            @Override public void cancel(Context c,android.app.PendingIntent tick){calls.add("cancel");}
        };
        WidgetRefresh.fetcher=token->{throw new java.io.IOException("No network in this check");};
        try {
            assertTrue(manager.bindAppWidgetIdIfAllowed(id,new android.content.ComponentName(context,CompanionWidgetProvider.class)));
            CompanionSettings.save(context,id,CompanionSettings.preset("Agent activity"));
            String generation=WidgetStore.connect(context,"synthetic-activity");
            assertTrue(WidgetStore.finish(context,generation,active.getJSONObject("snapshot"),""));
            calls.clear();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            String armed=calls.get(calls.size()-1);
            assertTrue(armed,armed.startsWith("set:"+android.app.AlarmManager.RTC+":"));
            assertNotEquals("Never RTC_WAKEUP",android.app.AlarmManager.RTC_WAKEUP,android.app.AlarmManager.RTC);
            long delay=Long.parseLong(armed.substring(armed.lastIndexOf(':')+1));
            assertTrue("About a minute: "+delay,delay>50000&&delay<=60000);
            assertNotNull("The periodic job remains the background cadence",context.getSystemService(JobScheduler.class));
            CompanionSettings.save(context,id,CompanionSettings.preset("Development"));
            calls.clear();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            assertEquals("Cancelled when no companion shows Agent activity","cancel",calls.get(calls.size()-1));
            CompanionSettings.save(context,id,CompanionSettings.preset("Agent activity"));
            assertTrue(WidgetStore.finish(context,generation,idle.getJSONObject("snapshot"),""));
            calls.clear();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            assertEquals("Cancelled when nothing is running","cancel",calls.get(calls.size()-1));
            assertTrue(WidgetStore.finish(context,generation,active.getJSONObject("snapshot"),""));
            WidgetStore.clear(context,null);
            calls.clear();InstrumentationRegistry.getInstrumentation().runOnMainSync(()->OwnerWidgetProvider.renderAll(context));
            assertEquals("Cancelled when signed out","cancel",calls.get(calls.size()-1));
        } finally {
            host.deleteHost();CompanionSettings.remove(context,id);
            shell("appwidget revokebind --package "+context.getPackageName()+" --user 0");
        }
    }

    private void tapRefresh() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            assertTrue("No account activity is open", ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).isEmpty());
            View widget = OwnerWidgetProvider.views(context, WidgetStore.read(context), true).apply(context, new FrameLayout(context));
            assertTrue(widget.findViewById(R.id.monitor_refresh).performClick());
        });
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
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
                assertEquals(View.VISIBLE, view.findViewById(R.id.monitor_details).getVisibility());
                assertTrue(view.findViewById(R.id.monitor_list) instanceof android.widget.ListView);
                assertTrue(view.findViewById(R.id.monitor_refresh).getHeight() >= 40 * density);
                assertTrue(view.findViewById(R.id.monitor_refresh).hasOnClickListeners());
                assertTrue(view.findViewById(R.id.monitor_account).hasOnClickListeners());
                bounds(view);
                if (name.equals("refreshing")) {
                    assertEquals("REFRESHING", ((TextView) view.findViewById(R.id.monitor_health)).getText().toString());
                    assertTrue(view.findViewById(R.id.monitor_checked).getContentDescription().toString().startsWith("Last reading "));
                }
                if (name.startsWith("cached-error")) {
                    assertEquals("LAST KNOWN STATUS", ((TextView) view.findViewById(R.id.monitor_health)).getText().toString());
                    assertTrue(((TextView) view.findViewById(R.id.monitor_identity)).getText().toString().contains("Test Owner"));
                }
                assertNull("Owner email is not shown on the widget face", textContaining(view, "widget@example.invalid"));
                assertTrue(view.findViewById(R.id.monitor_open).hasOnClickListeners());
                assertTrue(view.findViewById(R.id.monitor_open).getHeight() >= 44 * density);
                assertTrue(view.findViewById(R.id.monitor_refresh).getHeight() >= 44 * density);
                assertEquals(1, ((TextView) view.findViewById(R.id.monitor_services)).getMaxLines());
                if (name.equals("signed-out") || name.equals("stale") || name.equals("unavailable")) {
                    assertEquals("—", ((TextView) view.findViewById(R.id.monitor_active)).getText().toString());
                    assertEquals("—", ((TextView) view.findViewById(R.id.monitor_accounts)).getText().toString());
                    assertEquals("—", ((TextView) view.findViewById(R.id.monitor_campaigns)).getText().toString());
                    assertEquals("—", ((TextView) view.findViewById(R.id.monitor_requests)).getText().toString());
                    assertFalse(((TextView) view.findViewById(R.id.monitor_identity)).getText().toString().contains("Test Owner"));
                }
            } catch (Throwable error) { failure[0] = error; }
        });
        if (failure[0] != null) throw new AssertionError(name, failure[0]);
    }
    private void bounds(View view) {
        // ListView children are intentionally partially clipped while scrolling.
        if (!(view instanceof ViewGroup) || view instanceof android.widget.ListView) return;
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
