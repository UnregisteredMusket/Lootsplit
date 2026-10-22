-- Additive indexes only; no table or data changes (D1 rows-read investigation, 2026-10-22).
-- Every owner monitor serve reads the current development task. Without these, each of its
-- three queries scans and sorts the whole task table, which gains a row per CI step.
-- Live (not yet terminal) tasks: only the few still running are indexed.
CREATE INDEX IF NOT EXISTS owner_monitor_tasks_live ON owner_monitor_tasks(updated_at) WHERE NOT json_extract(body,'$.state') IN ('completed','failed','idle');
-- The newest terminal task in display order: an ordered read of one row.
CREATE INDEX IF NOT EXISTS owner_monitor_tasks_terminal ON owner_monitor_tasks((json_extract(body,'$.source')='owner') DESC,updated_at DESC,id DESC) WHERE json_extract(body,'$.state') IN ('completed','failed','idle');
-- Latest finished workflow heartbeat per branch, read from the index alone.
CREATE INDEX IF NOT EXISTS owner_monitor_tasks_workflow_branch ON owner_monitor_tasks(json_extract(body,'$.branch'),json_extract(body,'$.heartbeatAt')) WHERE json_extract(body,'$.source')='workflow' AND json_extract(body,'$.state') IN ('completed','failed','idle');
