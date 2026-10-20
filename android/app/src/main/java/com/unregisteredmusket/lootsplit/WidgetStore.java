package com.unregisteredmusket.lootsplit;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Private, backup-excluded widget state. Never return its credential to JavaScript or a host. */
final class WidgetStore {
    private static final String KEY = "lootsplit.owner.widget.v1";
    private static JSONObject state;

    static File file(Context context) {
        return new File(context.getNoBackupFilesDir(), "owner-widget.enc");
    }

    private static SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (!keys.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey(KEY, null);
    }

    private static JSONObject empty() throws Exception {
        return new JSONObject().put("generation", UUID.randomUUID().toString())
            .put("message", "Connect in My account");
    }

    static synchronized JSONObject read(Context context) {
        try {
            if (state == null) {
                AtomicFile file = new AtomicFile(file(context));
                if (file.getBaseFile().exists()) {
                    byte[] bytes = file.readFully();
                    if (bytes.length < 29 || bytes.length > 262144) throw new Exception("Invalid storage");
                    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, bytes, 0, 12));
                    state = new JSONObject(new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8));
                } else state = empty();
            }
            return new JSONObject(state.toString());
        } catch (Exception ignored) {
            // A restored/corrupt file or invalidated key cannot restore owner access.
            new AtomicFile(file(context)).delete();
            try { state = empty(); } catch (Exception impossible) { state = new JSONObject(); }
            return new JSONObject();
        }
    }

    private static void save(Context context, JSONObject next) throws Exception {
        AtomicFile file = new AtomicFile(file(context));
        FileOutputStream stream = null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
            stream = file.startWrite();
            stream.write(cipher.getIV());
            stream.write(encrypted);
            file.finishWrite(stream);
            state = next;
        } catch (Exception failure) {
            if (stream != null) file.failWrite(stream);
            clear(context, null);
            throw failure;
        }
    }

    static synchronized String connect(Context context, String token) throws Exception {
        JSONObject next = empty().put("token", token).put("message", "Checking owner access…");
        save(context, next);
        return next.getString("generation");
    }

    static synchronized boolean finish(Context context, String generation, JSONObject snapshot, String message) throws Exception {
        JSONObject current = read(context);
        if (!generation.equals(current.optString("generation"))) return false;
        current.put("snapshot", snapshot == null ? JSONObject.NULL : snapshot).put("message", message);
        save(context, current);
        return true;
    }

    /** Keep the last dated reading during refresh or temporary transport failure. */
    static synchronized boolean message(Context context, String generation, String message) throws Exception {
        JSONObject current = read(context);
        if (!generation.equals(current.optString("generation"))) return false;
        current.put("message", message);
        save(context, current);
        return true;
    }

    static synchronized boolean clear(Context context, String expectedToken) {
        if (expectedToken != null && !expectedToken.equals(read(context).optString("token"))) return false;
        new AtomicFile(file(context)).delete();
        try { state = empty(); } catch (Exception ignored) { state = new JSONObject(); }
        return true;
    }

    static synchronized boolean clearGeneration(Context context, String generation) {
        if (!generation.equals(read(context).optString("generation"))) return false;
        return clear(context, null);
    }
}
