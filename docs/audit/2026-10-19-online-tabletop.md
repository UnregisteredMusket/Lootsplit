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

## Integrated workspace checkpoint (continued October 19)

The working implementation now connects the session bar/searchable map cards, inspector, drag/group/keyboard/exact-coordinate moves, temporary measurement and persistent templates, manual fog tools, walls/doors/lights, optional vision, player-view preview, explicit camera actions and default-off TV controls to canonical commands. The source retains old exact-position forms and all original navigation/record tools. Token styles and canonical portraits remain additive. No production mutation or APK distribution has occurred.

UVTT0.2/0.3 import uses bounded data-only parsing, embedded PNG/WebP, reviewed grid/geometry and clipping/approximation notices. Source documentation is credited in Resources. Detailed media remains independently authenticated and hashed. Offline preparation publishes both originals and pre-rendered frames when hosting begins; identical render content reuses its media reference. Complete device backups now include nested archive media. Account backups store verified media separately from bounded JSON rows and hydrate it before replacement; historical report downloads check the original seat/report projection. Older clients receive compatible record envelopes or an explicit updated-website requirement, retaining the source backup.

An end-to-end regression found a real duplicate-projection error: the player device re-evaluated visibility using already-redacted fog geometry, hiding an authorized token. Joined-client display now uses an internal already-projected option. The server never accepts that option from API input and continues authoritative filtering. The direct regression passes. A separate complete-backup regression found unreadable older archives being parsed by the new media collector; raw bytes and diagnostics are preserved again.

Local evidence, before subsequent documented presentation/help refinements:

- Original complete map/display audit passed at1280/390:66.574s browser execution,67.245s total audit process; every old flow and clean app-error assertion retained.
- Expanded complete map audit passed at1280/390:132.455s browser execution,133.128s process. Adds remote assigned-token coordinate/keyboard/drag movement, measure/templates, explicit activation and independent/shared cameras, actual decoded pixel conceal/reveal/undo/redo and guest refresh. The source is frozen in an isolated disposable copy during each run so ongoing development HMR cannot replace React contexts mid-audit. No deadlines or assertions were weakened. New scope is not a comparable speed regression against the shorter old audit.
- Complete quick checks passed:1035 tests,1031pass,4 existing skips; types pass, lint0errors/36warnings at that checkpoint. New refresh/unused warnings were subsequently corrected; final checks remain required.
- Later targeted tabletop/account-media/backup regressions:28/28pass in1661.667ms. Earlier account-media/backup-only14/14pass in1159.566ms; import/account/recovery focused49/49pass.
- Recovered browser executable was truncated (44.5MB versus197.4MB expected), not incompatible. The retained ZIP passed CRC; restoration produced launchable Chromium153.0.8010.12. Both real mobile/desktop map screenshots were inspected. Fullscreen flow uses the existing native dialog; layout refinements remain subject to final visual verification.
- Both Help guides were reviewed and expanded; current MAP-TILES, inventory, README and coding manual describe role permissions, media/import limits, visibility/confidentiality, reconnect/backup and website-versus-APK availability. Existing reference restrictions and canonical finance/encounter/ship workflows remain.

Performance history was read through cursor2026-10-19T09:48:15.046Z:1070observations,17resolutions,one older pending historical run37642398740. Latest recorder39247898837 succeeded. Since the prior1067-observation checkpoint, scheduled standby run39228550754 added checkout1→2s(+1s,+100%), setup-node4→6s(+2s,+50%) and synthetic rehearsal1→2s(+1s,+100%). These small infrastructure/rehearsal measurements do not establish application latency changes; preserve them and compare later scheduled runs. Historical increasing account/interface/gameplay/unit/governance trends remain recorded, including changed audit workloads; this task resets none. New map coverage roughly doubles browser workload and will be recorded under the new local scope while CI retains its existing comparison/history. Fresh PR/main timing/total-wait analysis remains required before release.

Remaining: final reviewed UVTT/high-detail media browser acceptance, final source tests/types/lint and both builds, role Help/navigation preservation checks, exact-head all-nine PR/main verification, automatic immutable deployment/standby and read-only live asset/desktop/mobile validation. Do not treat these local passes or a checkpoint push as release evidence.
