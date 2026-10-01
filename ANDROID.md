# Lootsplit Android

The installable app is a packaged copy of the interface. Campaign files, device backups, and local mode stay on the phone. Shared rooms still use the existing Cloudflare Worker at `https://lootsplit.oliverstorie2017.workers.dev`. The APK does not contain the D1 database id, Worker secrets, or server source.

Capacitor does not load that site with `server.url`. `npm run build:mobile` writes a client into `dist/mobile-build`, then copies it to `dist/mobile`. The APK serves those files from `https://localhost`. That mobile build does not replace `dist/server`, which the Cloudflare deploy uses.

After this change is deployed, the Worker accepts server-function calls from `https://localhost`, `http://localhost`, and `capacitor://localhost`. A normal browser visit to the Worker is unchanged. Until that deploy, the website keeps working and the APK cannot join a shared room.

## Test APK

The GitHub Action **Android test APK** builds `app-debug.apk`. That file is signed with the build machine's debug key. It is not a Play Store release. A later test APK may not install over an older one if the debug key changed; uninstall the previous test copy first.

From a phone:

1. Open https://github.com/UnregisteredMusket/Lootsplit/actions/workflows/android-test-apk.yml
2. Run workflow on `main`.
3. When it finishes, download the `lootsplit-test-apk` artifact and install `app-debug.apk`.
4. Allow installation from the browser or Files app if Android asks.

## Release signing

Keep one upload keystore outside the repository. Use that same keystore for every update. A new keystore makes Android treat the app as a different application.

Create it once, on a machine you control:

```bash
keytool -genkeypair -v -keystore lootsplit-release.jks -alias lootsplit -keyalg RSA -keysize 2048 -validity 10000
```

Store the file and both passwords somewhere private. For GitHub, add these repository secrets, not files in git:

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 lootsplit-release.jks`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS` — `lootsplit`
- `ANDROID_KEY_PASSWORD`

Do not commit `*.jks`, `*.keystore`, or those passwords. This repository's workflow does not sign a release APK.
