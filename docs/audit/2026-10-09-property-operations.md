# Property operations implementation audit — October 9, 2026

## Implemented behavior

The approved catalogue contains 24 editable fantasy presets. Existing property listings and purchase-generated inventory deeds initialize optional operating templates; older unconfigured holdings keep their behavior. Storage uses canonical item lots with physical custody, ownership and material reservations. Assigned party characters share party property by default; the DM can select access, capacity, withdrawal approval and explicit location overrides. An approved withdrawal keeps goods stored until the requester collects them in the correct location; access, quantity and unchanged goods are revalidated.

Reviewed work recipes cover staged construction, upgrades, repairs, gathering and production, using contractors and assigned character downtime without double booking. Materials reserve and consume once, and completed buildings attach to one legal parcel. Staff proposals, editable contracts, required roles, managers, budgets, arrears and tenant occupancy connect to existing recurring finances. Reviewed supplier terms can be edited; purchased shipments retain their original terms. City shop post offices, postage, delayed campaign-day letters and standing orders recheck permissions, budgets, funds and stock. These remain in-game correspondence.

The existing stored downtime preview and explicit next-session DM approval apply all effects atomically. Existing income → loans → expenses ordering remains intact. Generic legacy finance rules retain their controls, while new wage and tenancy agreements use their property controls. Nonempty stores or obligations block ordinary sale/Give; a documented DM handover preserves deeds, goods and agreements. Bargaining/trading remains deferred.

DM imports use strict versioned JSON, relational validation, explicit owner/location mappings, a pure reviewed preview and one stale-checked authoritative command. They create empty inactive configurations/listings without economic side effects or fabricated deeds. Instructions, downloadable sample and generated structural schema are available in the estate workshop and Help. No migration, dependency or signed Android APK changes.

## Local verification

Functional source checkpoint: `3c465b93c531711fea221fe0418f63b1b2d5a269`, tree `a06f2a90ecdaad67064a73070cc2306e57790620`. Clean disposable source copies contain the same tracked application files. Verification used Node 22.23.3 and diagnostic Chromium 133. Full CI must independently verify the locked current browser, account network isolation, packaged Worker and standby.

- Complete quick verification: 776 tests, 772 passed and four pre-existing skipped; no failures. Typecheck passed; lint has zero errors and 30 pre-existing warnings. The 16 new estate tests cover lifecycle, conservation, permissions, approvals, wages, rental, budgets, transit, import, privacy, offline persistence and backups.
- Clean Cloudflare build: 11.481s; mobile client build: 9.632s. An earlier working-directory build failed during cleanup of ignored `dist` output with ENOTEMPTY; a fresh disposable checkout passed. Failed evidence remains in the local recovery records; no source or release gate was changed to bypass it.
- New property UI: 42.638s browser work (43.553s bounded process), desktop 1280/mobile 390, dark/light. Actual file import/mappings, activation, donation/deposit/withdrawal, manager hiring, city postage, recipe/project, explicit approved downtime, completion/delivery, reload, same-document navigation and viewport fit passed.
- Existing property register/deed audit: 79.438s, including 320px editor fit, real shared purchase, SVG image rendering, transfer, recipient reload, sale removal, historical receipt preservation and memory-only guests.
- Existing finance audit: 62.344s, complete desktop/mobile financial/property workflows. Production campaigns were not accessed or mutated.

No test deadline, account scenario, worker count, retry policy, network assertion, title/navigation check or release gate was removed. Two new full-suite browser steps exercise property operations against development and the immutable packaged Worker.

## Performance analysis

Latest reviewed persistent history: `ba4479e7f30025273018d9a38df24bdd2980d0a2`, scan cursor 2026-10-09T09:33:01.149Z. It contains 692 qualifying observations and 13 resolutions, with 344 open trends, 184 repeated increases. Recorder run [37912471286](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37912471286) succeeded at 09:37:45 UTC. Pending older run 37642398740 remains visible in the capture state; no evidence or cursor was deleted.

The existing local property audit reference is 99.355s; the new run took 79.438s (19.917s/20.05% less). The finance reference is 80.746s versus 62.344s (18.402s/22.79% less). These diagnostic runs do not establish an application speed improvement; faster/sub-15% runs do not advance the persistent reference. The new complete property-operations audit and clean-checkout web build receive initial measured references because their operation/scope is new. A preliminary working-tree estate audit took 40.654s; the final 42.638s is 4.88% higher, below the slowdown threshold, with the same complete workflow coverage.

The warm mobile build reference was 5.464s; the new complete build took 9.632s, +4.168s/+76.28%, and is recorded conservatively in `performance/manual-measurements.jsonl`. The larger new property module and concurrent disposable-browser startup affect the measurement; a causal application regression is not established. Follow-up: inspect the same mobile-build step in full CI and bundle output before considering any reset. No reference was reset.

Recent release-main observations remain open: encounter step 32→37s (+5s/+15.63%), packaged sound 18→25s (+7s/+38.89%) and packaged interface job 196→273s (+77s/+39.29%). The full verification workflow did not produce a new qualifying slowdown in that observation window; jobs overlap, so their durations are not summed. Repeated infrastructure/workload trends include browser installation 21→372s over four increases (+351s/+1671.43%) and code-checks job 48→144s over four increases (+96s/+200%). These require runner/cache/workload analysis; they are not silently attributed to this feature or closed. The new full CI must retain every qualifying workflow/job/step observation and report fresh release timings separately.

## Release checkpoint

This audit records completed local implementation and verification. Full exact-tree PR verification, independent main verification, deployment/standby and the read-only live asset/desktop/mobile audit remain required before claiming this update is live. The release's final immutable identities, run links and results will be recorded in the implementation PR and exact-state recovery checkpoint.
