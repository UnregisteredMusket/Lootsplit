# Lootsplit Android

The installable app is a packaged copy of the interface. Campaign files, device backups, and local mode stay on the phone. Shared rooms still use the existing Cloudflare Worker at `https://lootsplit.oliverstorie2017.workers.dev`. The APK does not contain the D1 database id, Worker secrets, or server source.

Capacitor does not load that site with `server.url`. `npm run build:mobile` writes a client into `dist/mobile-build`, then copies it to `dist/mobile`. The APK serves those files from `https://localhost`. That mobile build does not replace `dist/server`, which the Cloudflare deploy uses.

After this change is deployed, the Worker accepts server-function calls from `https://localhost`, `http://localhost`, and `capacitor://localhost`. A normal browser visit to the Worker is unchanged. Until that deploy, the website keeps working and the APK cannot join a shared room.

## Test APK

The GitHub Action **Android test APK** builds `app-debug.apk`. Run it manually or push a prepared update to an `android/**` branch after verifying the web release. Version 1.3.1 uses Android version code 4; the previous permanent-key 1.3.0 uses code 3. The APK is signed with the build machine's debug key, not a Play Store release key. A later test APK may not install over an older one if the debug key changed. Export and verify a backup of local campaigns before uninstalling an old test copy; uninstalling removes its local data.

From a phone:

1. Open https://github.com/UnregisteredMusket/Lootsplit/actions/workflows/android-test-apk.yml
2. Run workflow on `main`.
3. When it finishes, download the `lootsplit-test-apk` artifact and install `app-debug.apk`.
4. Allow installation from the browser or Files app if Android asks.

## Release signing

The permanent signing key is already configured. Use the existing GitHub repository secrets for every update: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Do not generate a replacement key, retrieve secret values, or ask the owner to paste passwords. The owner retains the original private backup.

Do not commit `*.jks`, `*.keystore`, or those passwords. The **Android signed release APK** workflow signs using these four repository secrets. It verifies the APK signature and uploads only the APK, never the keystore. Missing secrets stop the build. The decoded keystore is temporary and removed on exit. Debug builds remain separate and are not release updates.

The permanent keystore was generated on 2026-10-01, downloaded by the owner for backup, and configured through the four repository secrets. Its alias is `lootsplit`. The workflow requires certificate SHA-256 `BA:CA:95:A8:80:D1:4D:0D:8C:42:2C:39:7D:EC:D4:C9:BF:0E:7F:71:0A:3F:D6:A5:BE:1E:47:AB:D3:F7:30:A0` and refuses to upload an APK signed by another key. Keep the keystore and passwords backed up securely. Never generate a fresh key automatically during a build.

The first release-signed APK cannot normally replace the old debug-signed installation. Export and verify all local campaigns before a one-time uninstall/reinstall; thereafter retain this signing key and increase versionCode for every distributed update.

## Releases from main (1.3.1 onward)

`main` is the shared web/Android source. Increase `APP_VERSION`, Android `versionName`, and Android `versionCode` together, update `docs/RELEASE-NOTES.md`, and merge verified changes. A version-file or signed-release-workflow change on main starts the signed-release workflow; it can also be run manually on main. Tests, type checking, both builds, monotonic version checks, and the permanent certificate check must pass. A versioned GitHub Release holds `Lootsplit-VERSION.apk` and `SHA256SUMS.txt`; do not overwrite an existing release. Actions artifacts remain available as secondary downloads.

Android exports now ask whether to Save file or Share. Save file uses Android's document picker and reports success only after writing/closing the stream. Choose Downloads or another location outside app-private storage. Sharing only hands the file to another application: confirm that application's save/send completed. Cancelling preserves the campaign and named device backup. Neither private device backups nor shared room membership replace an external backup.

The bundled Android client must be updated by installing the newer signed APK. Changes deployed to the website do not rewrite its bundled interface. The backend remains the existing Cloudflare Worker.
