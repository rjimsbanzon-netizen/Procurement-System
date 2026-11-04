/** SQLite-backed D1 adapter for isolated HTTP integration tests.
 * Every test creates a NEW in-memory database and applies actual migration SQL.
 * This never connects to Cloudflare or an existing database.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

class LocalStatement {
  constructor(db, sql, params = []) { this.db=db; this.sql=sql; this.params=params; }
  bind(...params) { return new LocalStatement(this.db, this.sql, params); }
  prepared() { return this.db.prepare(this.sql); }
  async first(column) {
    const row = this.prepared().get(...this.params) ?? null;
    return column ? row?.[column] ?? null : row;
  }
  async all() {
    const results = this.prepared().all(...this.params);
    return {success:true, results, meta:{changes:0}};
  }
  async run() {
    const stmt = this.prepared();
    if (/\breturning\b/i.test(this.sql)) {
      const results = stmt.all(...this.params);
      return {success:true, results, meta:{changes:results.length}};
    }
    // SQLite's changes count is from the top-level statement; trigger activity
    // should not be mistaken for a second update in the HTTP implementation.
    const result = stmt.run(...this.params);
    return {success:true, results:[], meta:{changes:Number(result.changes), last_row_id:Number(result.lastInsertRowid)}};
  }
}
export class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys=ON;');
    this.db.exec(readFileSync(resolve(root, 'src/db/schema.sql'), 'utf8'));
    const migrations = readdirSync(resolve(root, 'cloudflare/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
    for (const migration of migrations) {
      this.db.exec(readFileSync(resolve(root, 'cloudflare/migrations', migration), 'utf8'));
    }
  }
  prepare(sql) { return new LocalStatement(this.db,sql); }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=[];
      for (const statement of statements) result.push(await statement.run());
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { this.db.exec(sql); return {success:true}; }
  close() { this.db.close(); }
  seedUser({id,username=id,name=id,role='employee',app_role='Employee',department='',company_name='',status='approved',access_revoked=0}) {
    // Legacy SHA256 passwords work with the existing login upgrade path.
    const passwordHash = createHash('sha256').update('test-password-123').digest('hex');
    this.db.prepare(`INSERT INTO users(id,username,password_hash,name,email,role,app_role,status,department,company_name,access_revoked,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
      .run(id,username,passwordHash,name,`${username}@example.invalid`,role,app_role,status,department,company_name,access_revoked);
  }
  seedWorkspace(workspace) {
    this.db.prepare("INSERT INTO enterprise_state(id,data,updated_at) VALUES(1,?,datetime('now'))").run(JSON.stringify(workspace));
  }
}

export function emptyWorkspace() {
  return Object.fromEntries([
    'stockNeeds','bids','proposalMeetings','requisitions','orders',
    'deliveries','amendments','payments','suppliers','ratings'
  ].map(name=>[name,[]]));
}
