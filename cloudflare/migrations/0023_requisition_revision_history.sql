-- Retain rejected PR evidence when the same PR ID is corrected and resubmitted.
-- Does not change existing approvals or enterprise_state; safe additive migration.
CREATE TABLE IF NOT EXISTS pr_revision_history (
  pr_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL CHECK(cycle_no >= 0),
  rejected_at TEXT NOT NULL,
  rejected_by TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  pr_json TEXT NOT NULL,
  workflow_json TEXT NOT NULL DEFAULT 'null',
  steps_json TEXT NOT NULL DEFAULT '[]',
  finance_head_json TEXT NOT NULL DEFAULT 'null',
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(pr_id, cycle_no)
);
CREATE INDEX IF NOT EXISTS idx_pr_revision_history_date ON pr_revision_history(archived_at DESC);
-- Archived rejection/approval cycles are append-only. An Admin reset explicitly
-- clears this table, so deletion is left to server-owned reset logic.
CREATE TRIGGER IF NOT EXISTS pr_revision_history_no_update
BEFORE UPDATE ON pr_revision_history BEGIN
 SELECT RAISE(ABORT,'PR revision history cannot be changed');
END;
