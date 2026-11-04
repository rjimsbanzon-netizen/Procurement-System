-- Emergency ONLY: removes Phase 4 audit protection triggers, not audit rows.
-- Use only after exporting a private DB backup and approving the rollback.
DROP TRIGGER IF EXISTS trg_audit_evidence_immutable_core;
DROP TRIGGER IF EXISTS trg_audit_evidence_no_delete;
DROP TRIGGER IF EXISTS trg_audit_evidence_reviews_no_update;
DROP TRIGGER IF EXISTS trg_audit_evidence_reviews_no_delete;
