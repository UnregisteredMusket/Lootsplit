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
        result.put("installed", OwnerWidgetProvider.ids(getContext()).length + CompanionWidgetProvider.ids(getContext()).length);
        org.json.JSONArray companions = new org.json.JSONArray();
        for (int id : CompanionWidgetProvider.ids(getContext())) companions.put(id);
        result.put("companions", companions);
        org.json.JSONArray mainWidgets = new org.json.JSONArray();
        for (int id : OwnerWidgetProvider.ids(getContext())) mainWidgets.put(id);
        result.put("mainWidgets", mainWidgets);
        result.put("pinSupported", Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported());
        call.resolve(result);
    }
    @PluginMethod public void connect(PluginCall call) {
        String token = call.getString("token", "");
        if (token.isEmpty() || token.length() > 4096 || java.util.regex.Pattern.compile("[\\p{Cntrl}]").matcher(token).find()) {
            call.reject("Sign in to your owner account first."); return;
        }
        final String generation;
        WidgetClient.initialize(getContext());
        try { generation = WidgetStore.connect(getContext(), token); }
        catch (Exception ignored) { call.reject("Secure widget storage is unavailable."); return; }
        OwnerWidgetProvider.renderAll(getContext());
        executor.execute(() -> {
            try {
                JSONObject snapshot = WidgetClient.fetch(token);
                if (!WidgetStore.finish(getContext(), generation, snapshot, "")) {
                    call.reject("Account changed. Connect the widget again."); return;
                }
                OwnerWidgetJob.schedule(getContext());
                call.resolve();
            } catch (WidgetClient.AccessDenied ignored) {
                try { WidgetStore.revoke(getContext(), generation, "Owner authorization was rejected. Tap Sign in to reconnect."); } catch (Exception failure) { WidgetStore.clearGeneration(getContext(), generation); }
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
    @PluginMethod public void sync(PluginCall call) {
        JSONObject state=WidgetStore.read(getContext());
        String expected=call.getString("expectedToken","");
        if(expected.isEmpty()||!expected.equals(state.optString("token"))){call.resolve();return;}
        try {
            JSObject input=call.getObject("snapshot");
            if(input==null||input.toString().length()>262144){call.reject("Invalid monitor snapshot.");return;}
            JSONObject snapshot=WidgetData.project(input,System.currentTimeMillis());
            WidgetStore.finish(getContext(),state.optString("generation"),snapshot,"");
            OwnerWidgetProvider.renderAll(getContext());call.resolve();
        }catch(Exception ignored){call.reject("Monitor snapshot could not be synchronized.");}
    }
    @PluginMethod public void pin(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26 || !AppWidgetManager.getInstance(getContext()).isRequestPinAppWidgetSupported()) {
            call.reject("Long-press your home screen, choose Widgets, then Lootsplit Field monitor."); return;
        }
        boolean requested = AppWidgetManager.getInstance(getContext()).requestPinAppWidget(
            new ComponentName(getContext(), "companion".equals(call.getString("kind")) ? CompanionWidgetProvider.class : OwnerWidgetProvider.class), null, null);
        JSObject result = new JSObject(); result.put("requested", requested); call.resolve(result);
    }
    @PluginMethod public void consumeOpenRequest(PluginCall call) {
        boolean open = getActivity().getIntent().getBooleanExtra(OwnerWidgetProvider.OPEN, false);
        getActivity().getIntent().removeExtra(OwnerWidgetProvider.OPEN);
        String destination = WidgetActions.destination(getActivity().getIntent().getStringExtra(WidgetActions.DESTINATION));
        getActivity().getIntent().removeExtra(WidgetActions.DESTINATION);
        JSObject result = new JSObject(); result.put("open", open); result.put("destination", destination); call.resolve(result);
    }
    @PluginMethod public void configure(PluginCall call) {
        Integer id = call.getInt("widgetId");
        if (id == null) { call.reject("Choose a companion widget instance."); return; }
        getActivity().startActivity(new android.content.Intent(getContext(), CompanionWidgetConfigureActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)); call.resolve();
    }
    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
}
