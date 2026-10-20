#!/usr/bin/env bash
set -uo pipefail
(cd android && ./gradlew :app:connectedDebugAndroidTest --no-daemon)
result=$?
mkdir -p test-results/android-widget
adb pull /sdcard/Android/data/com.unregisteredmusket.lootsplit/files/widget-audit test-results/android-widget/
screenshots=$?
if [ "$result" -ne 0 ]; then exit "$result"; fi
if [ "$screenshots" -ne 0 ]; then exit "$screenshots"; fi
test -f test-results/android-widget/widget-audit/full-350.png
test -f test-results/android-widget/widget-audit/compact-250.png
