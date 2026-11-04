-- Phase 3 (D1-compatible revision): backward-compatible indexed mirror.
-- Avoids UNION ALL because D1 may cap compound SELECT to fewer than 10 terms.
-- enterprise_state remains canonical. Existing Finance/Sourcing/Operations writes
-- synchronize this table via triggers in the SAME transaction.
-- Apply on a BACKUP/test D1 first; this adds write overhead proportional to the
-- snapshot size and does not itself switch the browser to row-by-row reads.
CREATE TABLE IF NOT EXISTS workspace_record_index (
  collection TEXT NOT NULL CHECK (collection IN ('stockNeeds', 'bids', 'proposalMeetings', 'requisitions', 'orders', 'deliveries', 'amendments', 'payments', 'suppliers', 'ratings')),
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  department TEXT,
  supplier_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection,record_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_index_department ON workspace_record_index (collection,department,record_id);
CREATE INDEX IF NOT EXISTS idx_workspace_index_supplier ON workspace_record_index (collection,supplier_id,record_id);

-- Retry-safe backfill. This index is derived; only its rows are replaced.
-- The canonical enterprise_state and all transactional tables are untouched.
DELETE FROM workspace_record_index;
INSERT OR REPLACE INTO workspace_record_index
  (collection,record_id,payload,department,supplier_id,updated_at)
SELECT c.value, CAST(json_extract(r.value,'$.id') AS TEXT) AS record_id,
       r.value, CAST(json_extract(r.value,'$.department') AS TEXT),
       CAST(json_extract(r.value,'$.supplierId') AS TEXT), s.updated_at
FROM enterprise_state AS s
CROSS JOIN json_each('["stockNeeds","bids","proposalMeetings","requisitions","orders","deliveries","amendments","payments","suppliers","ratings"]') AS c
CROSS JOIN json_each(s.data, '$.' || c.value) AS r
WHERE r.type='object' AND json_type(r.value,'$.id')='text' AND length(json_extract(r.value,'$.id')) BETWEEN 1 AND 100;

-- Replace any partially installed triggers from an earlier failed migration.
DROP TRIGGER IF EXISTS trg_workspace_index_insert;
DROP TRIGGER IF EXISTS trg_workspace_index_update;
DROP TRIGGER IF EXISTS trg_workspace_index_delete;

-- Trigger also catches legacy specialized routes that update enterprise_state.
CREATE TRIGGER IF NOT EXISTS trg_workspace_index_insert AFTER INSERT ON enterprise_state
WHEN NEW.id=1
BEGIN
  -- An indexed set comparison avoids an O(N^2) correlated scan of every row.
  DELETE FROM workspace_record_index
   WHERE (collection,record_id) NOT IN (
     SELECT c.value, CAST(json_extract(r.value,'$.id') AS TEXT)
       FROM json_each('["stockNeeds","bids","proposalMeetings","requisitions","orders","deliveries","amendments","payments","suppliers","ratings"]') AS c
       CROSS JOIN json_each(NEW.data, '$.' || c.value) AS r
      WHERE r.type='object' AND json_type(r.value,'$.id')='text'
        AND length(json_extract(r.value,'$.id')) BETWEEN 1 AND 100
   );
  INSERT INTO workspace_record_index
    (collection,record_id,payload,department,supplier_id,updated_at)
SELECT c.value, CAST(json_extract(r.value,'$.id') AS TEXT) AS record_id,
       r.value, CAST(json_extract(r.value,'$.department') AS TEXT),
       CAST(json_extract(r.value,'$.supplierId') AS TEXT), NEW.updated_at
FROM (SELECT 1) AS s
CROSS JOIN json_each('["stockNeeds","bids","proposalMeetings","requisitions","orders","deliveries","amendments","payments","suppliers","ratings"]') AS c
CROSS JOIN json_each(NEW.data, '$.' || c.value) AS r
WHERE r.type='object' AND json_type(r.value,'$.id')='text' AND length(json_extract(r.value,'$.id')) BETWEEN 1 AND 100
  ON CONFLICT(collection,record_id) DO UPDATE SET
    payload=excluded.payload, department=excluded.department,
    supplier_id=excluded.supplier_id, updated_at=excluded.updated_at
  WHERE workspace_record_index.payload <> excluded.payload;
END;

-- Trigger also catches legacy specialized routes that update enterprise_state.
CREATE TRIGGER IF NOT EXISTS trg_workspace_index_update AFTER UPDATE OF data ON enterprise_state
WHEN NEW.id=1
BEGIN
  -- An indexed set comparison avoids an O(N^2) correlated scan of every row.
  DELETE FROM workspace_record_index
   WHERE (collection,record_id) NOT IN (
     SELECT c.value, CAST(json_extract(r.value,'$.id') AS TEXT)
       FROM json_each('["stockNeeds","bids","proposalMeetings","requisitions","orders","deliveries","amendments","payments","suppliers","ratings"]') AS c
       CROSS JOIN json_each(NEW.data, '$.' || c.value) AS r
      WHERE r.type='object' AND json_type(r.value,'$.id')='text'
        AND length(json_extract(r.value,'$.id')) BETWEEN 1 AND 100
   );
  INSERT INTO workspace_record_index
    (collection,record_id,payload,department,supplier_id,updated_at)
SELECT c.value, CAST(json_extract(r.value,'$.id') AS TEXT) AS record_id,
       r.value, CAST(json_extract(r.value,'$.department') AS TEXT),
       CAST(json_extract(r.value,'$.supplierId') AS TEXT), NEW.updated_at
FROM (SELECT 1) AS s
CROSS JOIN json_each('["stockNeeds","bids","proposalMeetings","requisitions","orders","deliveries","amendments","payments","suppliers","ratings"]') AS c
CROSS JOIN json_each(NEW.data, '$.' || c.value) AS r
WHERE r.type='object' AND json_type(r.value,'$.id')='text' AND length(json_extract(r.value,'$.id')) BETWEEN 1 AND 100
  ON CONFLICT(collection,record_id) DO UPDATE SET
    payload=excluded.payload, department=excluded.department,
    supplier_id=excluded.supplier_id, updated_at=excluded.updated_at
  WHERE workspace_record_index.payload <> excluded.payload;
END;

CREATE TRIGGER IF NOT EXISTS trg_workspace_index_delete AFTER DELETE ON enterprise_state
WHEN OLD.id=1
BEGIN
  DELETE FROM workspace_record_index;
END;
