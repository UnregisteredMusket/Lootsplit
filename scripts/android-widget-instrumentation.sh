#!/usr/bin/env bash
set -uo pipefail
# This task installs disposable test APKs. Never point it at a physical phone.
test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 || { echo "::error title=Android instrumentation refused::Connected device is not an emulator"; exit 1; }
results=android/app/build/outputs/androidTest-results
mkdir -p test-results/android-widget
# AGP waits ADB_INSTALL_TIMEOUT minutes (default 4) on a stuck install-write before failing;
# a healthy emulator installs these APKs in seconds.
export ADB_INSTALL_TIMEOUT=${ADB_INSTALL_TIMEOUT:-2}

testcases() {
  python3 - "$results" <<'PY'
import glob, os, sys, xml.etree.ElementTree as ET
n = 0
for path in glob.glob(os.path.join(sys.argv[1], "**", "*.xml"), recursive=True):
    try:
        n += sum(1 for _ in ET.parse(path).iter("testcase"))
    except ET.ParseError:
        pass
print(n)
PY
}

for attempt in 1 2; do
  rm -rf "$results"
  # AGP otherwise uninstalls the app (and its screenshots) before adb can collect them.
  (cd android && ./gradlew :app:connectedDebugAndroidTest -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true --no-daemon) 2>&1 | tee "test-results/android-widget/gradle-connected-$attempt.log"
  result=${PIPESTATUS[0]}
  [ "$result" -eq 0 ] && break
  ran=$(testcases)
  # Retry only when no test case ran at all: the emulator dropped offline or the APK
  # install-write failed before instrumentation started. Any test that ran and failed
  # is reported as-is and never retried.
  if [ "$attempt" = 1 ] && [ "$ran" = 0 ]; then
    detail=$(grep -E 'What went wrong|install|Install|offline|DeviceException|ShellCommandUnresponsive|No connected devices|FAILED' "test-results/android-widget/gradle-connected-1.log" | tail -n 6 | tr '\n' ' ' | cut -c1-700)
    echo "::warning title=Android instrumentation did not start (retrying once)::$detail"
    adb uninstall com.unregisteredmusket.lootsplit.test >/dev/null 2>&1 || true
    adb uninstall com.unregisteredmusket.lootsplit >/dev/null 2>&1 || true
    bash scripts/android-emulator-ready.sh 180 || exit 1
    continue
  fi
  break
done

adb pull /sdcard/Android/data/com.unregisteredmusket.lootsplit/files/widget-audit test-results/android-widget/
screenshots=$?
adb uninstall com.unregisteredmusket.lootsplit.test >/dev/null 2>&1 || true
adb uninstall com.unregisteredmusket.lootsplit >/dev/null 2>&1 || true
if [ "$result" -ne 0 ]; then
  # Job logs and artifacts are not readable from the development sandbox; annotations are.
  python3 scripts/android-test-annotations.py "$results" || true
  log=$(ls test-results/android-widget/gradle-connected-*.log | tail -n 1)
  echo "::error title=Gradle connectedDebugAndroidTest failed::$(grep -E 'What went wrong|install|offline|Exception|FAILED|tests completed' "$log" | tail -n 8 | tr '\n' ' ' | cut -c1-900)"
  exit "$result"
fi
if [ "$screenshots" -ne 0 ]; then echo "::error title=Widget screenshots missing::adb pull of widget-audit failed"; exit "$screenshots"; fi
for shot in full-350 compact-250; do
  test -f "test-results/android-widget/widget-audit/$shot.png" || { echo "::error title=Widget screenshot missing::$shot.png was not produced"; exit 1; }
done
