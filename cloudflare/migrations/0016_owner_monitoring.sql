-- Operational history is private to the current site owner. No campaign tables change.
CREATE TABLE owner_monitor_config (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE owner_monitor_registry (id TEXT PRIMARY KEY, body TEXT NOT NULL, registered_at INTEGER NOT NULL, last_success INTEGER);
CREATE TABLE owner_monitor_intervals (
  slot INTEGER PRIMARY KEY, outcome TEXT NOT NULL, started_at INTEGER, collected_at INTEGER,
  lease TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, body TEXT
);
CREATE TABLE owner_monitor_logs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL REFERENCES owner_monitor_registry(id), observed_at INTEGER NOT NULL,
  collected_at INTEGER NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX owner_monitor_logs_chronology ON owner_monitor_logs(observed_at,sequence);
CREATE INDEX owner_monitor_logs_source ON owner_monitor_logs(source,observed_at);
CREATE TABLE owner_monitor_snapshots (revision INTEGER PRIMARY KEY AUTOINCREMENT, collected_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE owner_monitor_tasks (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE owner_monitor_incidents (component TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE owner_monitor_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, reported_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE owner_monitor_reports (id TEXT PRIMARY KEY, day TEXT NOT NULL, timezone TEXT NOT NULL, generated_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE owner_monitor_report_refresh (report_id TEXT PRIMARY KEY REFERENCES owner_monitor_reports(id), requested_at INTEGER NOT NULL);
-- Late observations automatically queue already-generated calendar reports for correction.
CREATE TRIGGER owner_monitor_late_log AFTER INSERT ON owner_monitor_logs BEGIN
  INSERT INTO owner_monitor_report_refresh(report_id,requested_at)
  SELECT id,NEW.collected_at FROM owner_monitor_reports
  WHERE json_extract(body,'$.start')<=NEW.observed_at AND json_extract(body,'$.end')>NEW.observed_at
  ON CONFLICT(report_id) DO UPDATE SET requested_at=MAX(requested_at,excluded.requested_at);
END;
CREATE TABLE owner_monitor_ingest (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
