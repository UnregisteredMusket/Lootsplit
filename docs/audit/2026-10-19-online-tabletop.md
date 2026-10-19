# Online tabletop update

See ../plans/ONLINE-TABLETOP.md for authorization, baseline, phased scope and preservation invariants.

Current stage: baseline reconciled; preview and implementation in progress. Production unchanged. No feature or release pass is claimed.

Environment: Node22.23.3 and locked npm dependencies restored. The previously retained Chrome153 binary exits SIGSEGV in this recovered runtime. Diagnose a compatible local browser; use current-browser CI for any remaining documented gap without weakening release checks. The older retained QA runtime is being checked independently. Do not repeatedly rerun the same failed browser installation.

Development branch: feature/online-tabletop, based on main1cce8f7. Evolving exact identities and evidence will be appended at meaningful checkpoints.
