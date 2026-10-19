# Online tabletop update

See ../plans/ONLINE-TABLETOP.md for authorization, baseline, phased scope and preservation invariants.

Current stage: baseline and committed interactive preview complete; canonical tabletop foundation in development. Production unchanged. No complete feature or release pass is claimed.

Environment: Node22.23.3 and locked npm dependencies restored. The previously retained Chrome153 binary exits SIGSEGV in this recovered runtime. Diagnose a compatible local browser; use current-browser CI for any remaining documented gap without weakening release checks. The older retained QA runtime is being checked independently. Do not repeatedly rerun the same failed browser installation.

Development branch: feature/online-tabletop, based on main1cce8f7. Evolving exact identities and evidence will be appended at meaningful checkpoints.

## Foundation checkpoint

Preview/scope commit3303016dbe0a3924e879f4038abc2b94277f6172 is retained on GitHub. The preview is self-contained, uses only synthetic records and makes no campaign requests. Its JavaScript parses successfully; it is not the finished integrated feature.

Added optional canonical session/scene/token metadata, explicit activation/camera policy and default-off TV setting; exact-position group movement with ownership/lock/barrier checks; saved manual fog with bounded undo/redo; optional sight/light geometry; distance and area-template calculations; and player-safe geometry/history filtering. Fog/vision scenes currently fall back to a concealed raster until the forthcoming authorized raster-publication path supplies actual revealed pixels. A CSS/SVG overlay is not claimed as pixel confidentiality.

An additive room protocol omits unsupported fields from older APK envelopes after privacy projection. Legacy map/token/journal writes retain new configuration and permissions. Unknown pending map actions are retained and require resolution on the updated client. Account-resume/asset/export compatibility remains to be integrated and verified.

Focused foundation/map/display/room-store verification:55tests,55pass,0fail,0skip in2502.388ms. This adds cases to the prior53-test development workload, so those totals are not a comparable speed benchmark. New tabletop-specific tests independently pass13/13. Type checks pass. Focused lint has0errors/1pre-existing unused-variable warning in session-records.ts. Full quick checks, browser integration, builds, all nine PR/main groups and immutable/read-only-live release checks remain pending.

Local Chrome153 and the retained fallback both exit SIGSEGV. One fresh locked-browser download returned a truncated archive and failed; do not retry that unchanged installation. The cloud browser rejects the development loopback URL with ERR_BLOCKED_BY_CLIENT. These are named local verification gaps, not evidence of a production or user network outage; current-browser CI must close rendering evidence. A partial asynchronous redirected test log was not accepted as a pass; the foreground complete55-test run above supplies its TAP summary.

Next: protected/chunked map media and pixel-baked player presentations, then the integrated workspace, protocol/account/archive boundaries, live seat fixtures and preserved full release gates.

## Private media groundwork

Added additive D1 media migration0015 (not applied to production): account-owned immutable media manifests/parts, 20MB and 8192-edge/64MP bounds, a 2GB owner reservation limit, checksum and supported-format validation, fresh campaign/seat checks on reads and DM-only publication. Original pixels travel separately from ordinary campaign envelopes; small previews remain compatible with existing raster maps. Movement revisions invalidate player renders. Current individual-view renders are scoped to assigned characters; private source assets remain inaccessible to player seats. Pings now respect scene access and point visibility.

The DM renderer zeroes concealed source RGBA before encoding and publishes revision/audience-scoped still images. A globally mounted publisher keeps this independent of the DM's current workspace. Protected videos use a still poster rather than transmitting concealed video frames. New imports preserve source bytes and load detail through short-lived object URLs; local DM copies support offline play. Device backup/restore includes and verifies current map media before replacement. Account backup/history compatibility, pixel-level browser verification and end-to-end controls remain pending; none are claimed complete.

Focused assets/tabletop/backup verification:28tests,28pass,0fail in643.081ms. Asset scenarios use disposable directories; a fixture initially exposed a module-load working-directory mistake, corrected by importing storage only after isolating the fixture. The stray synthetic room was removed by exact identity without changing other local records. Type checks passed before the final media UI wiring; current checks and full release gates remain pending.
