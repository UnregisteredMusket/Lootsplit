-- Shared-room receipts by campaign and command ID (audit A2, 2026-11-10). Receipts were looked up by
-- <seatId>:<command id>, so a player who left and rejoined (a new seat ID) could apply an old action
-- again. This partial index on the command ID part of the key lets one lookup find a command's
-- receipt under any seat, including every receipt written before it, without a second row per action.
CREATE INDEX IF NOT EXISTS campaign_room_receipts_command_id ON campaign_room_receipts(code, substr(key, instr(key, ':') + 1)) WHERE kind = 'command';
