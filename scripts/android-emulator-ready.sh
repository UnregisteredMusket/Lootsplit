#!/usr/bin/env bash
# Wait until a disposable CI emulator can really accept installs and UI input.
# `sys.boot_completed` alone is not enough: an API 24 emulator can report boot
# complete while adb is offline, the package manager is not yet serving, or the
# launcher has not taken focus. Every failure is printed as a GitHub annotation,
# because job logs are not readable from the development sandbox.
# Usage: android-emulator-ready.sh [timeout-seconds]  (default 240)
set -uo pipefail
limit=${1:-240}
deadline=$((SECONDS + limit))

fail() {
  echo "::error title=Android emulator not ready::$1 (after $((SECONDS - deadline + limit))s; adb devices: $(adb devices 2>&1 | tr '\n' ' ' | cut -c1-300))"
  exit 1
}

prop() { timeout 10 adb shell getprop "$1" 2>/dev/null | tr -d '\r'; }

# An emulator whose adb transport dropped shows as "offline"; ask adb to re-establish it.
adb reconnect offline >/dev/null 2>&1 || true
timeout "$limit" adb wait-for-device || fail "adb never saw the emulator"

until [ "$(prop sys.boot_completed)" = 1 ] && [ "$(prop dev.bootcomplete)" = 1 ] \
  && [ "$(prop init.svc.bootanim)" = stopped ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "boot did not complete"
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 2
done

# The package manager service answers only once the framework is fully up.
until timeout 15 adb shell pm path android 2>/dev/null | grep -q '^package:'; do
  [ "$SECONDS" -lt "$deadline" ] || fail "package manager is not serving"
  sleep 2
done

[ "$(prop ro.kernel.qemu)" = 1 ] || fail "connected device is not an emulator"

# Wait (bounded, informational) for the launcher to own focus so the first long-press lands.
until timeout 10 adb shell dumpsys window windows 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | grep -qi launcher; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::warning title=Android launcher focus not observed::$(timeout 10 adb shell dumpsys window windows 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r' | cut -c1-300)"
    break
  fi
  adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
  sleep 2
done
echo "Emulator ready after $((SECONDS - deadline + limit))s: API $(prop ro.build.version.sdk)"
