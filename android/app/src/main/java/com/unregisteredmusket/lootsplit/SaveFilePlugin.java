package com.unregisteredmusket.lootsplit;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-selected document writes persist outside app-private storage. No broad storage permission. */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {
    private boolean presenting;

    @PluginMethod
    public void save(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (presenting) { call.reject("A file export is already open."); return; }
            presenting = true;
            new AlertDialog.Builder(getActivity())
                .setTitle("Export file")
                .setItems(new String[]{"Save file…", "Share…"}, (dialog, choice) -> {
                    if (choice == 1) { finish(call, "share"); return; }
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType(call.getString("mime", "application/octet-stream"));
                    intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "lootsplit.json"));
                    try { startActivityForResult(call, intent, "savedDocument"); }
                    catch (Exception e) { presenting = false; call.reject("Could not open the file picker.", e); }
                })
                .setOnCancelListener(dialog -> finish(call, "cancelled"))
                .show();
        });
    }

    private void finish(PluginCall call, String action) {
        presenting = false;
        call.resolve(new JSObject().put("action", action));
    }

    @ActivityCallback
    private void savedDocument(PluginCall call, ActivityResult result) {
        if (call == null) { presenting = false; return; }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            finish(call, "cancelled"); return;
        }
        getBridge().execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (stream == null) throw new IllegalStateException("No writable document.");
                String data = call.getString("data", "");
                byte[] bytes = Boolean.TRUE.equals(call.getBoolean("base64", false))
                    ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
                stream.write(bytes);
                stream.flush();
            } catch (Exception e) {
                presenting = false;
                call.reject("The file could not be saved. Your campaign is unchanged; retry the export.", e);
                return;
            }
            finish(call, "saved");
        });
    }
}
