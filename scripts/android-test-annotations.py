"""Print each failed instrumentation test as a GitHub annotation (::error) from JUnit XML results."""
import glob
import os
import sys
import xml.etree.ElementTree as ET


def clean(text, limit=900):
    text = " ".join((text or "").split())
    return text[:limit].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main(root):
    found = 0
    for path in sorted(glob.glob(os.path.join(root, "**", "*.xml"), recursive=True)):
        try:
            tree = ET.parse(path)
        except ET.ParseError:
            continue
        for case in tree.iter("testcase"):
            for problem in list(case.findall("failure")) + list(case.findall("error")):
                found += 1
                name = f"{case.get('classname', '')}.{case.get('name', '')}"
                detail = problem.get("message") or problem.text or ""
                print(f"::error title=Android test failed: {clean(case.get('name', ''), 120)}::{clean(name, 200)}: {clean(detail)}")
    if not found:
        print(f"::error title=Android instrumentation failed::No failed test case in {root}; the run stopped before or outside the tests (emulator, install or Gradle).")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "android/app/build/outputs/androidTest-results")
