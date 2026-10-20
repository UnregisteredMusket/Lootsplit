# Phone Maps layout correction

The owner confirms functionality and requests correction of the crowded phone composition shown in their screenshot. Baseline main74cad893f03275f00ef71915990806af67547bd0 is verified/live; no earlier publication is repeated.

The existing mobile styles placed the horizontal tool strip 220px above the bottom alongside a 200px vertical camera stack, with a 142px scene stack higher up. At narrow widths the primary strip clipped its More control. A disposable448×824 real-component capture reproduces the composition. New portrait styles anchor tools at the bottom, arrange camera/scene controls as short horizontal rows, place Settings beside the title and give search its own full-width row. The primary tools swipe independently of the always-visible More button. A collapse chevron distinguishes the dock toggle from Drawing. Smaller 36px marker symbols retain 44px hit targets and selected states. Desktop reference placement is retained; narrow landscape has its own bounded arrangement.

This is a presentation correction. All commands, player projections, tools, permission controls, media, saved maps, cameras and gameplay paths remain. Fresh mobile entry covers the map viewport; the reported background band can occur outside the artwork at a stored pan/zoom or explicit Fit map. No saved camera is discarded or silently zoomed in to hide that area.

Verification extends the existing complete map audit, retaining all original scenarios, viewport and camera assertions. It checks 320px/390px/448px portrait and 568px/844px landscape, dock bounds/non-overlap,44px targets and real top-layer hit tests for every scrolled primary tool and expanded More control. Browser keyboard/panel and rotation checks remain. Synthetic local fixtures only; no live campaign mutations.

Both role Help guides, feature inventory, README, map guide and developer verification/recovery instructions are reviewed/updated. Phone instructions explain swiping the tools and the fixed More control. Role restrictions and setup/scene/media/encounter instructions remain unchanged. No Android APK is published.

Performance history synchronized at the start:1140 observations,17 historical resolution records and one historical pending run37642398740. No new observations since the completed workspace release; no history clearing or reference reset. Final measured local durations, exact-head PR/main/immutable/live results and refreshed recorder analysis follow in the release checkpoint.

## Local verification checkpoint

Real-component previews pass with no runtime errors or page overflow at448×824,390×844,320×700,568×320 and844×390, plus desktop/light and Settings captures. Visual review caught a narrow-landscape scene/camera overlap; the scene row now leaves the right camera column clear. The retained online-tabletop flow exposed the expanded More panel covering Zoom; it now opens above the camera row. The added hit tests explicitly check camera buttons while More is expanded. Marker-selection assertions now inspect the actually painted symbol, preserving the original selected/unselected color checks after moving mobile marker paint into an inset pseudo-element. No original scenario or assertion was removed.

The complete world audit passes desktop/mobile in161.692s with no browser errors. Compared with the last logged comparable concurrent-world reference149.419s, this is+12.273s/+8.21%, below the15% logging threshold; the new control-hit/viewport checks add work. Quick checks pass all1046 tests (1042 passes/four intentional skips), TypeScript and ESLint (zero errors/39 existing warnings). Website/mobile builds pass. Final-source map audit, all-nine PR/main verification and immutable/read-only live proof remain required before publication.
