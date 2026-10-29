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
    /** Set on the copy {@link #read} returns while Keystore/IO is temporarily unavailable. */
    static final String UNAVAILABLE = "storageUnavailable";
    private static JSONObject state;
    /** Package-private seam so instrumentation can simulate a busy Keystore; never app or JS input. */
    interface KeySource { SecretKey key() throws Exception; }
    static volatile KeySource keys = WidgetStore::key;

    /** Thrown only when the stored file can never be read again (corrupt, restored, key invalidated). */
    static final class Corrupt extends Exception { Corrupt(String message) { super(message); } }

    /** Only these failures prove the credential is unrecoverable; anything else may succeed on retry. */
    static boolean permanent(Throwable failure) {
        return failure instanceof Corrupt
            // AEADBadTagException (tag mismatch: tampered file, or a key that is not the one that wrote it).
            // A Keystore daemon failure inside doFinal surfaces as IllegalBlockSizeException: transient.
            || failure instanceof javax.crypto.BadPaddingException
            || failure instanceof org.json.JSONException
            || failure instanceof android.security.keystore.KeyPermanentlyInvalidatedException
            || failure instanceof java.security.UnrecoverableKeyException;
    }

    static File file(Context context) {
        return new File(context.getNoBackupFilesDir(), "owner-widget.enc");
    }

    // Why the connection last ended. Removing or re-adding widgets never ends it (2026-10-29): only
    // the app's Disconnect widget, a 401/403 from the server, or an unusable key/file does. The reason
    // is kept outside the encrypted file, so it survives a lost key, and holds no credential.
    static final String REASON_IN_APP = "Disconnected in app";
    static final String REASON_REJECTED = "Owner access rejected";
    static final String REASON_KEY = "Encryption key reset";
    static final String REASON_LEGACY = "App sign-out ended an older connection";
    static final String REASON_CONNECT = "Connection did not finish";

    static File reasonFile(Context context) {
        return new File(context.getNoBackupFilesDir(), "owner-widget-disconnect.json");
    }

    /** Records why the stored connection was removed (best effort; never blocks the clear). */
    static synchronized void recordReason(Context context, String reason) {
        try {
            AtomicFile file = new AtomicFile(reasonFile(context));
            FileOutputStream stream = file.startWrite();
            try {
                stream.write(new JSONObject().put("reason", reason).put("at", System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8));
                file.finishWrite(stream);
            } catch (Exception failure) { file.failWrite(stream); }
        } catch (Exception ignored) { }
    }

    /** The last recorded disconnect ({reason, at}), or null when none was recorded. */
    static synchronized JSONObject lastDisconnect(Context context) {
        try {
            AtomicFile file = new AtomicFile(reasonFile(context));
            if (!file.getBaseFile().exists()) return null;
            byte[] bytes = file.readFully();
            if (bytes.length > 4096) return null;
            JSONObject value = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            return value.optString("reason").isEmpty() ? null : value;
        } catch (Exception ignored) { return null; }
    }

    /** "Owner access rejected · 29/10/2026 10:41", or "" when no disconnect was recorded. */
    static String disconnectNote(Context context) {
        JSONObject last = lastDisconnect(context);
        if (last == null) return "";
        long at = last.optLong("at");
        return last.optString("reason") + (at > 0 ? " · " + WidgetRows.clock(at) : "");
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

    private static JSONObject load(Context context) throws Exception {
        AtomicFile file = new AtomicFile(file(context));
        if (!file.getBaseFile().exists()) return empty();
        byte[] bytes = file.readFully();
        if (bytes.length < 29 || bytes.length > 262144) throw new Corrupt("Invalid storage");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        SecretKey key = keys.key();
        if (key == null) throw new java.security.KeyStoreException("Key unavailable");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12));
        return new JSONObject(new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8));
    }

    static synchronized JSONObject read(Context context) {
        if (state == null) {
            Exception failure = null;
            // One immediate retry absorbs a momentarily busy Keystore daemon.
            for (int attempt = 0; attempt < 2 && state == null; attempt++) {
                try { state = load(context); failure = null; }
                catch (Exception error) { failure = error; if (permanent(error)) break; }
            }
            if (state == null) {
                if (failure != null && permanent(failure)) {
                    // A restored/corrupt file or invalidated key cannot restore owner access.
                    new AtomicFile(file(context)).delete();
                    recordReason(context, REASON_KEY);
                    try { state = empty(); } catch (Exception impossible) { state = new JSONObject(); }
                    return new JSONObject();
                }
                // Transient Keystore/IO error: keep the encrypted connection and report it, uncached,
                // so the next read tries again. No token is returned, and the generation never matches.
                try { return new JSONObject().put(UNAVAILABLE, true).put("message", WidgetRefresh.STORAGE_BUSY); }
                catch (org.json.JSONException impossible) { return new JSONObject(); }
            }
        }
        try { return new JSONObject(state.toString()); }
        catch (org.json.JSONException impossible) { return new JSONObject(); }
    }

    /** Instrumentation only: drop the in-memory copy, as a new process would. */
    static synchronized void forgetCache() { state = null; }

    private static void save(Context context, JSONObject next) throws Exception {
        AtomicFile file = new AtomicFile(file(context));
        FileOutputStream stream = null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            SecretKey key = keys.key();
            if (key == null) throw new java.security.KeyStoreException("Key unavailable");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] encrypted = cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
            stream = file.startWrite();
            stream.write(cipher.getIV());
            stream.write(encrypted);
            file.finishWrite(stream);
            state = next;
        } catch (Exception failure) {
            if (stream != null) file.failWrite(stream);
            // failWrite keeps the previous file; only an unusable key also ends the connection.
            if (permanent(failure)) remove(context, REASON_KEY);
            throw failure;
        }
    }

    static synchronized String connect(Context context, String token) throws Exception {
        JSONObject next = empty().put("token", token).put("message", "Checking owner access…");
        save(context, next);
        new AtomicFile(reasonFile(context)).delete(); // Connected again: the old reason no longer applies.
        return next.getString("generation");
    }

    static synchronized boolean finish(Context context, String generation, JSONObject snapshot, String message) throws Exception {
        JSONObject current = read(context);
        if (!generation.equals(current.optString("generation"))) return false;
        JSONObject old = current.optJSONObject("snapshot");
        if (snapshot != null && old != null && snapshot.optLong("snapshotId") > 0 && old.optLong("snapshotId") > snapshot.optLong("snapshotId")) return false;
        if (snapshot != null && old != null) {
            JSONObject task = snapshot.optJSONObject("task"), prior = old.optJSONObject("task");
            if (task != null && prior != null && task.optString("id").equals(prior.optString("id")) && task.optLong("revision") < prior.optLong("revision")) { snapshot.put("task", prior); snapshot.put("warning",old.optString("warning")); }
        }
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

    /**
     * The app's explicit Disconnect widget ({@code expectedToken} null), or the app clearing a legacy
     * widget that still holds the app's own token ({@code expectedToken} given: sign-out, sign-in,
     * a rejected app session). The widget's own session never matches the app token, so app sign-in
     * and sign-out leave it connected; a token that cannot be compared (busy Keystore) is kept too,
     * because a legacy token the server no longer accepts ends on its next check (401) anyway.
     */
    static synchronized boolean clear(Context context, String expectedToken) {
        if (expectedToken != null) {
            JSONObject current = read(context);
            if (current.optBoolean(UNAVAILABLE) || !expectedToken.equals(current.optString("token"))) return false;
        }
        return remove(context, expectedToken == null ? REASON_IN_APP : REASON_LEGACY);
    }

    /** Removes the stored connection and records why; the only place the encrypted file is deleted on purpose. */
    static synchronized boolean remove(Context context, String reason) {
        boolean existed = file(context).exists();
        new AtomicFile(file(context)).delete();
        try { state = empty(); } catch (Exception ignored) { state = new JSONObject(); }
        if (existed && reason != null) recordReason(context, reason);
        return true;
    }

    static synchronized boolean clearGeneration(Context context, String generation, String reason) {
        if (!generation.equals(read(context).optString("generation"))) return false;
        return remove(context, reason);
    }
    static synchronized boolean revoke(Context context, String generation, String reason) throws Exception {
        if (!generation.equals(read(context).optString("generation"))) return false;
        remove(context, REASON_REJECTED);
        save(context, empty().put("message", reason));
        return true;
    }
    static synchronized String deviceId(Context context) {
        File file = new File(context.getNoBackupFilesDir(), "owner-widget-device.txt");
        try {
            if (file.exists()) { String id = new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8); if (id.matches("[a-f0-9-]{36}")) return id; }
            String id = UUID.randomUUID().toString();
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(id.getBytes(StandardCharsets.UTF_8)); }
            return id;
        } catch (Exception ignored) { return ""; }
    }
}
