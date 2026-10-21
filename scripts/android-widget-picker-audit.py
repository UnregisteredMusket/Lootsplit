#!/usr/bin/env python3
"""Read the real launcher picker on a disposable emulator, never a user's phone."""
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

OUT = pathlib.Path("test-results/android-widget") / ("picker-installed" if "--add-companion" in sys.argv else "picker")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=25).decode().strip()


def snapshot(name):
    adb("shell", "uiautomator", "dump", "/sdcard/lootsplit-picker.xml")
    xml = adb("shell", "cat", "/sdcard/lootsplit-picker.xml")
    (OUT / (name + ".xml")).write_text(xml)
    with (OUT / (name + ".png")).open("wb") as image:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=image, check=True, timeout=20)
    return ET.fromstring(xml)


def label(node):
    return " ".join([node.get("text", ""), node.get("content-desc", "")]).strip()


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds", "")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


assert adb("shell", "getprop", "ro.kernel.qemu") == "1", "Emulator only"
package = adb("shell", "dumpsys", "package", "com.unregisteredmusket.lootsplit")
(OUT / "package.txt").write_text(package)
adb("shell", "input", "keyevent", "KEYCODE_HOME")
home = snapshot("home")
bounds = home.find("node").get("bounds")
_, _, width, height = map(int, re.findall(r"\d+", bounds))
# The fresh emulator's middle workspace is empty; do not clear launcher data.
x, y = str(width // 2), str(height * 45 // 100)
adb("shell", "input", "swipe", x, y, x, y, "1300")
menu = snapshot("home-menu")
widgets = next((n for n in menu.iter("node") if label(n).lower() == "widgets"), None)
assert widgets is not None, "Launcher did not expose its Widgets action; inspect home-menu.png"
tap(widgets)
picker = snapshot("picker-open")
search = next((n for n in picker.iter("node") if n.get("class") == "android.widget.EditText"), None)
if search is not None:
    tap(search)
    adb("shell", "input", "text", "Lootsplit")
    adb("shell", "input", "keyevent", "KEYCODE_BACK")

seen = set()
expanded = False
for attempt in range(12):
    picker = snapshot("picker-" + str(attempt))
    labels = {label(n) for n in picker.iter("node")}
    seen.update(labels)
    group = next((n for n in picker.iter("node") if label(n) == "Lootsplit"), None)
    if group is not None and not expanded:
        tap(group)
        expanded = True
        continue
    if any("Field monitor" in s for s in seen) and any("4×1 companion" in s for s in seen):
        break
    adb("shell", "input", "swipe", str(width // 2), str(height * 77 // 100), str(width // 2), str(height * 32 // 100), "400")

providers = adb("shell", "dumpsys", "appwidget")
(OUT / "providers.txt").write_text(providers)
(OUT / "picker-labels.txt").write_text("\n".join(sorted(seen)))
assert "OwnerWidgetProvider" in providers, "Android did not register the main provider"
assert "CompanionWidgetProvider" in providers, "Android did not register the companion provider"
assert any("Field monitor" in s for s in seen), "Main widget missing from actual launcher picker"
assert any("4×1 companion" in s for s in seen), "Companion missing from actual launcher picker"
print("PASS: Android's real launcher picker exposes both Lootsplit widgets")

if "--add-companion" in sys.argv:
    # Android 15 Pixel Launcher exposes an Add action after tapping a preview.
    # Older hosts are tested through AppWidgetHost's real bind/configure/result flow.
    assert int(adb("shell", "getprop", "ro.build.version.sdk")) >= 35
    companion = None
    for attempt in range(6):
        companion = next((n for n in picker.iter("node") if "4×1 companion" in label(n) and n.get("resource-id", "").endswith("/widget_name")), None)
        if companion is not None:
            break
        adb("shell", "input", "swipe", str(width // 2), str(height * 77 // 100), str(width // 2), str(height * 32 // 100), "400")
        picker = snapshot("picker-add-" + str(attempt))
    assert companion is not None, "Companion preview must be visible before adding"
    tap(companion)
    preview = snapshot("companion-preview")
    add = next((n for n in preview.iter("node")
                if n.get("resource-id", "").endswith("/widget_add_button")
                and n.get("text", "").lower() == "add"
                and "4×1 companion" in n.get("content-desc", "")), None)
    assert add is not None, "Launcher Add action missing; inspect companion-preview.png"
    tap(add)
    home = snapshot("companion-added")
    assert any("OWNER" in label(n) and "SIGN IN" in label(n) for n in home.iter("node")), "Added companion must show its signed-out state on the home screen"
    providers = adb("shell", "dumpsys", "appwidget")
    (OUT / "providers-after-add.txt").write_text(providers)
    widgets = providers.split("Widgets:", 1)[1].split("Hosts:", 1)[0]
    assert "CompanionWidgetProvider" in widgets, "Launcher must bind an actual companion instance"
    print("PASS: Companion added from the launcher picker without My account or sign-in")
