#!/usr/bin/env bash
# Everything android-widget.yml runs inside the disposable emulator, as one script.
# (android-emulator-runner runs each `script:` line in its own `sh -c`, so `set -e`
# and multi-line error handling there do not apply across lines.)
# Each stage that fails prints a GitHub annotation naming the stage.
# Usage: android-widget-emulator.sh [--add-companion]
set -uo pipefail
cd "$(dirname "$0")/.."
apk=android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p test-results/android-widget

annotate_tail() { # title file
  echo "::error title=$1::$(tail -n 15 "$2" | tr '\n' ' ' | cut -c1-900)"
}

bash scripts/android-emulator-ready.sh 300 || exit 1

# Known transient adb install failures on a freshly booted emulator (offline transport,
# package manager not yet bound, install-write cut off). Retry once after re-checking
# readiness; any other install error fails immediately.
install_ok=0
for attempt in 1 2; do
  timeout 180 adb install -r "$apk" > test-results/android-widget/install.log 2>&1
  rc=$?
  if [ "$rc" = 0 ]; then
    install_ok=1
    break
  fi
  [ "$rc" = 124 ] && echo "adb install timed out after 180s" >> test-results/android-widget/install.log
  cat test-results/android-widget/install.log
  if [ "$attempt" = 1 ] && grep -qiE 'offline|device not found|no devices|closed|Can.t find service|install-write|Broken pipe|timed out|cmd: Failure calling service' test-results/android-widget/install.log; then
    echo "::warning title=Transient adb install failure (retrying once)::$(tail -n 5 test-results/android-widget/install.log | tr '\n' ' ' | cut -c1-600)"
    bash scripts/android-emulator-ready.sh 180 || exit 1
    continue
  fi
  break
done
if [ "$install_ok" != 1 ]; then
  annotate_tail "Debug APK install failed" test-results/android-widget/install.log
  exit 1
fi

if ! python3 scripts/android-widget-picker-audit.py "$@" > picker-audit.log 2>&1; then
  cat picker-audit.log
  annotate_tail "Widget picker audit failed" picker-audit.log
  exit 1
fi
cat picker-audit.log

if ! adb uninstall com.unregisteredmusket.lootsplit > test-results/android-widget/uninstall.log 2>&1; then
  annotate_tail "Debug APK uninstall failed" test-results/android-widget/uninstall.log
  exit 1
fi

bash scripts/android-widget-instrumentation.sh
