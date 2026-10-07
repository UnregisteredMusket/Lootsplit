# Account campaign resume reconciliation

Affected capabilities: account-owned DM saves, startup campaign selection, My campaigns, Live/turn-based pending commands and recovery export. No campaign server records, permissions, economic rules or migrations are changed.

The old client rejected every nonempty target queue before checking server acknowledgements. Resume now removes acknowledged IDs, combines the authenticated seat's server draft and remaining device commands, preserves unacknowledged batch IDs, and forces authoritative hydration/rebase. It never submits commands while opening a save. Genuine pending work becomes reachable through Multiplayer Retry/Export/Discard controls. Unrelated active queues still prevent switching.

Changed seat/token/role, a newer device revision, or conflicting copies of the same draft action require a separate durable device recovery record before opening the authoritative seat. Recovery records contain no authentication token, remain account-scoped in the UI, and cannot be imported under another seat. Guest pending commands remain in memory.

Local verification: 19 isolated tests passed, including execution of the actual resume function with synthetic transport/storage. Covers stale acknowledgements, ambiguous lost responses, server drafts, batch identity, mismatched account/seat, unrelated pending work, and recovery storage failure. These are not real-browser or full-build results. The existing DM-resume browser scenario is extended with actual account/startup card clicks at desktop/mobile widths, pending export/retry, acknowledged stale queues, and changed-seat recovery export. Full CI and release verification remain required; no production campaign was accessed or altered.

The recovered local checkouts predate current main. The authoritative source files were retrieved through the connected GitHub API after direct GitHub networking failed. Complete browser/build verification must use current-main dependencies/source; do not treat the isolated tests as a substitute or weaken release gates. No comparable performance baseline exists for these new isolated tests, and no historical performance reference was reset.

Next: exact-head full PR checks, main verification and website deployment/live audit; then a separately versioned signed Android patch and verified website download publication. Android1.5.0/code7 is already released and does not contain this fix.
