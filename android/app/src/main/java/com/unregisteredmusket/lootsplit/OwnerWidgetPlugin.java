package com.unregisteredmusket.lootsplit;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "OwnerWidget")
public class OwnerWidgetPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod public void status(PluginCall call) {
        JSONObject state = WidgetStore.read(getContext());
        JSObject result = new JSObject();
        result.put("connected", !state.optString("token").isEmpty());
        result.put("installed", OwnerWidgetProvider.ids(getContext()).length);
        result.put("pinSupported", Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported());
        call.resolve(result);
    }
    @PluginMethod public void connect(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty() || token.length() > 4096 || java.util.regex.Pattern.compile("[\\p{Cntrl}]").matcher(token).find()) {
            call.reject("Sign in to your owner account first."); return;
        }
        final String generation;
        try { generation = WidgetStore.connect(getContext(), token); }
        catch (Exception ignored) { call.reject("Secure widget storage is unavailable."); return; }
        OwnerWidgetProvider.renderAll(getContext());
        executor.execute(() -> {
            try {
                JSONObject snapshot = WidgetClient.fetch(token);
                if (!WidgetStore.finish(getContext(), generation, snapshot, "")) {
                    call.reject("Account changed. Connect the widget again."); return;
                }
                call.resolve();
            } catch (WidgetClient.AccessDenied ignored) {
                WidgetStore.clearGeneration(getContext(), generation);
                call.reject("An active site-owner session is required.");
            } catch (Exception ignored) {
                WidgetStore.clearGeneration(getContext(), generation);
                call.reject("Could not connect. Check your connection and try again.");
            } finally { OwnerWidgetProvider.renderAll(getContext()); }
        });
    }
    @PluginMethod public void disconnect(PluginCall call) {
        if (WidgetStore.clear(getContext(), call.getString("expectedToken"))) {
            OwnerWidgetJob.cancel(getContext());
            OwnerWidgetProvider.renderAll(getContext());
        }
        call.resolve();
    }
    @PluginMethod public void refresh(PluginCall call) {
        WidgetRefresh.request(getContext(), true, error -> {
            if (error.isEmpty()) call.resolve(); else call.reject(error);
        });
    }
    @PluginMethod public void pin(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26 || !AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported()) {
            call.reject("Long-press your home screen, choose Widgets, then Lootsplit Field monitor."); return;
        }
        boolean requested = AppWidgetManager.getInstance(getContext()).requestPinAppWidget(
            new ComponentName(getContext(), OwnerWidgetProvider.class), null, null);
        JSObject result = new JSObject(); result.put("requested", requested); call.resolve(result);
    }
    @PluginMethod public void consumeOpenRequest(PluginCall call) {
        boolean open = getActivity().getIntent().getBooleanExtra(OwnerWidgetProvider.OPEN, false);
        getActivity().getIntent().removeExtra(OwnerWidgetProvider.OPEN);
        JSObject result = new JSObject(); result.put("open", open); call.resolve(result);
    }
    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
}
