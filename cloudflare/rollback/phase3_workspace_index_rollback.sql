-- PHASE 3 EMERGENCY ROLLBACK ONLY.
-- This drops the DERIVED READ INDEX and its triggers, not enterprise_state.
-- Apply BEFORE restoring the old Phase 2 Worker (which uses meta.changes=1).
-- Requires an Admin-approved maintenance window and a fresh D1 backup.
DROP TRIGGER IF EXISTS trg_workspace_index_insert;
DROP TRIGGER IF EXISTS trg_workspace_index_update;
DROP TRIGGER IF EXISTS trg_workspace_index_delete;
DROP TABLE IF EXISTS workspace_record_index;
