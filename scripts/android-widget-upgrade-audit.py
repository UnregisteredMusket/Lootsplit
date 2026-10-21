#!/usr/bin/env python3
"""Verify the actual permanently signed APK upgrade before publication (emulator only)."""
import hashlib
import json
import pathlib
import subprocess
import urllib.request

def run(*args):
    subprocess.run(args, check=True, timeout=180)

assert subprocess.check_output(["adb", "shell", "getprop", "ro.kernel.qemu"]).decode().strip() == "1"
previous = json.loads(pathlib.Path("src/lib/website/release.json").read_text())
assert previous["apkUrl"].startswith("https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v")
directory = pathlib.Path("test-results/android-widget")
directory.mkdir(parents=True, exist_ok=True)
apk = directory / "previous.apk"
with urllib.request.urlopen(previous["apkUrl"], timeout=45) as response:
    data = response.read()
assert hashlib.sha256(data).hexdigest() == previous["sha256"], "Previous signed release checksum mismatch"
apk.write_bytes(data)
try:
    run("adb", "install", str(apk))
    # Populate the real launcher's provider cache with the previous released APK.
    run("python3", "scripts/android-widget-picker-audit.py")
    run("adb", "install", "-r", "android/app/build/outputs/apk/release/app-release.apk")
    # Do not open MainActivity/My account: the system upgrade broadcast must handle discovery.
    run("python3", "scripts/android-widget-picker-audit.py", "--add-companion")
    print("PASS: Permanently signed APK upgraded in place and its companion installed from Widgets")
finally:
    apk.unlink(missing_ok=True)
