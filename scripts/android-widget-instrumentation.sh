#!/usr/bin/env bash
set -uo pipefail
# This task installs disposable test APKs. Never point it at a physical phone.
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 || exit 1
# AGP otherwise uninstalls the app (and its screenshots) before adb can collect them.
(cd android && ./gradlew :app:connectedDebugAndroidTest -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true --no-daemon)
result=$?
mkdir -p test-results/android-widget
adb pull /sdcard/Android/data/com.unregisteredmusket.lootsplit/files/widget-audit test-results/android-widget/
screenshots=$?
adb uninstall com.unregisteredmusket.lootsplit.test >/dev/null 2>&1 || true
adb uninstall com.unregisteredmusket.lootsplit >/dev/null 2>&1 || true
if [ "$result" -ne 0 ]; then
  # Job logs and artifacts are not readable from the development sandbox; annotations are.
  python3 scripts/android-test-annotations.py android/app/build/outputs/androidTest-results || true
  exit "$result"
fi
if [ "$screenshots" -ne 0 ]; then exit "$screenshots"; fi
test -f test-results/android-widget/widget-audit/full-350.png
test -f test-results/android-widget/widget-audit/compact-250.png
