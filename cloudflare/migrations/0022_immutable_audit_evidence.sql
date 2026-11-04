-- Phase 4: append-only audit event history. Existing rows are retained.
-- The audit event's original actor/time/entity/before/after cannot be rewritten.
-- Admin may still update ONLY the review fields through the existing review API.
-- Apply after migration 0016. Test against a staging D1 database first.
CREATE TRIGGER IF NOT EXISTS trg_audit_evidence_immutable_core
BEFORE UPDATE ON audit_evidence
WHEN NOT (
  NEW.id IS OLD.id AND NEW.occurred_at IS OLD.occurred_at AND
  NEW.actor_id IS OLD.actor_id AND NEW.actor_name IS OLD.actor_name AND
  NEW.actor_role IS OLD.actor_role AND NEW.entity_type IS OLD.entity_type AND
  NEW.entity_ref IS OLD.entity_ref AND NEW.action IS OLD.action AND
  NEW.before_json IS OLD.before_json AND NEW.after_json IS OLD.after_json
)
BEGIN
  SELECT RAISE(ABORT,'Audit evidence core fields are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_evidence_no_delete
BEFORE DELETE ON audit_evidence
BEGIN
  SELECT RAISE(ABORT,'Audit evidence cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_evidence_reviews_no_update
BEFORE UPDATE ON audit_evidence_reviews
BEGIN
  SELECT RAISE(ABORT,'Audit review history cannot be rewritten');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_evidence_reviews_no_delete
BEFORE DELETE ON audit_evidence_reviews
BEGIN
  SELECT RAISE(ABORT,'Audit review history cannot be deleted');
END;
