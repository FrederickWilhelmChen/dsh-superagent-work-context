import { createHash } from 'node:crypto';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const EMPTY = { summary: '', facts: [], actions: [] };
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL, cursor INTEGER);
  CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, source TEXT NOT NULL, checked INTEGER);
  CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, source TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS evidence (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS evidence_by_id ON evidence (id, seq DESC);
  CREATE TABLE IF NOT EXISTS views (revision INTEGER PRIMARY KEY, through INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, trigger TEXT NOT NULL, body TEXT NOT NULL,
    attempted INTEGER, receipt TEXT, state TEXT NOT NULL
  );
`;

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export class Store {
  constructor(path) {
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.db.exec(SCHEMA);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() { this.db.close(); }

  atomic(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  meta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row && JSON.parse(row.value);
  }

  setMeta(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run(key, JSON.stringify(value));
  }

  bindIdentity(identity) {
    const previous = this.meta('identity');
    if (previous && JSON.stringify(previous) !== JSON.stringify(identity)) {
      throw new Error('Work-context state belongs to another bot or owner; choose a separate state directory');
    }
    if (!previous) this.setMeta('identity', identity);
  }

  setGroups(groups) {
    this.atomic(() => {
      this.db.exec('UPDATE groups SET active = 0');
      const upsert = this.db.prepare(`INSERT INTO groups (id, name, active) VALUES (?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = 1`);
      for (const { id, name } of groups) upsert.run(id, name);
    });
  }

  groups() { return this.db.prepare('SELECT id, name, cursor FROM groups WHERE active = 1 ORDER BY id').all(); }

  threads(limit) {
    return this.db.prepare(`SELECT t.* FROM threads t JOIN groups g ON g.id = t.source
      WHERE g.active = 1 ORDER BY t.checked NULLS FIRST, t.id LIMIT ?`).all(limit);
  }

  materials() {
    return this.db.prepare(`SELECT m.body FROM materials m JOIN groups g ON g.id = m.source
      WHERE g.active = 1 ORDER BY m.id`).all().map(({ body }) => JSON.parse(body));
  }

  append(record, links = []) {
    const body = JSON.stringify(record);
    const last = this.db.prepare('SELECT body FROM evidence WHERE id = ? ORDER BY seq DESC LIMIT 1').get(record.id);
    if (last?.body !== body) this.db.prepare('INSERT INTO evidence (id, source, body) VALUES (?, ?, ?)').run(record.id, record.source, body);
    if (record.thread) this.db.prepare('INSERT OR IGNORE INTO threads (id, source) VALUES (?, ?)').run(record.thread, record.source);
    const material = this.db.prepare('INSERT OR IGNORE INTO materials VALUES (?, ?, ?)');
    for (const link of links) material.run(link.id, link.source, JSON.stringify(link));
  }

  finishGroup(id, cursor) {
    this.db.prepare('UPDATE groups SET cursor = ? WHERE id = ?').run(cursor, id);
  }

  finishThread(id, checked) {
    this.db.prepare('UPDATE threads SET checked = ? WHERE id = ?').run(checked, id);
  }

  highwater() { return this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM evidence').get().seq; }

  pending(after, through, limit) {
    return this.db.prepare('SELECT seq, body FROM evidence WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?')
      .all(after, through, limit).map(({ seq, body }) => ({ seq, ...JSON.parse(body) }));
  }

  latest(id) {
    if (typeof id !== 'string') throw new Error('A work-context evidence ID is required');
    const row = this.db.prepare('SELECT seq, body FROM evidence WHERE id = ? ORDER BY seq DESC LIMIT 1').get(id);
    return row && { seq: row.seq, ...JSON.parse(row.body) };
  }

  related({ through, threads, terms, limit }) {
    const byThread = this.db.prepare(`SELECT e.seq, e.body FROM evidence e
      JOIN groups g ON g.id = e.source AND g.active = 1
      WHERE e.seq <= ? AND json_extract(e.body, '$.thread') = ?
      AND e.seq = (SELECT max(seq) FROM evidence WHERE id = e.id)
      ORDER BY e.seq DESC LIMIT ?`);
    const byTerm = this.db.prepare(`SELECT e.seq, e.body FROM evidence e
      JOIN groups g ON g.id = e.source AND g.active = 1
      WHERE e.seq <= ? AND instr(UPPER(json_extract(e.body, '$.text')), ?) > 0
      AND e.seq = (SELECT max(seq) FROM evidence WHERE id = e.id)
      ORDER BY e.seq DESC LIMIT ?`);
    const entries = [];
    for (const thread of threads) entries.push(...byThread.all(through, thread, 4));
    for (const term of terms) entries.push(...byTerm.all(through, term, 4));
    const unique = new Map(entries.map(row => [row.seq, row]));
    return [...unique.values()].slice(0, limit).map(row => ({ seq: row.seq, ...JSON.parse(row.body) }));
  }

  view() {
    const row = this.db.prepare('SELECT * FROM views ORDER BY revision DESC LIMIT 1').get();
    return row ? { revision: row.revision, through: row.through, context: JSON.parse(row.body) }
      : { revision: 0, through: 0, context: structuredClone(EMPTY) };
  }

  save(prev, through, context, reminders) {
    this.atomic(() => {
      if (this.view().revision !== prev.revision || through < prev.through || through > this.highwater()) {
        throw new Error('Work-context revision changed during analysis');
      }
      this.db.prepare('INSERT INTO views VALUES (?, ?, ?)').run(prev.revision + 1, through, JSON.stringify(context));
      const queue = this.db.prepare(`INSERT OR IGNORE INTO outbox (id, action, trigger, body, state) VALUES (?, ?, ?, ?, 'pending')`);
      for (const reminder of reminders) queue.run(reminder.id, reminder.key, reminder.trigger, JSON.stringify(reminder));
    });
  }

  pendingReminders() {
    return this.db.prepare("SELECT * FROM outbox WHERE state = 'pending' ORDER BY rowid").all();
  }

  attempt(id, at, payload) {
    this.db.prepare('UPDATE outbox SET attempted = ?, body = ? WHERE id = ? AND attempted IS NULL')
      .run(at, JSON.stringify(payload), id);
  }

  unresolvedAttachments() {
    return this.db.prepare(`SELECT e.source, json_extract(e.body, '$.unresolved') AS kind, count(*) AS total
      FROM evidence e JOIN groups g ON g.id = e.source AND g.active = 1
      WHERE kind IS NOT NULL AND e.seq = (SELECT max(seq) FROM evidence WHERE id = e.id)
      GROUP BY e.source, kind ORDER BY e.source, kind`).all();
  }

  mark(id, state, receipt = null) {
    this.db.prepare('UPDATE outbox SET state = ?, receipt = ? WHERE id = ?').run(state, receipt, id);
  }

  receiptCounts() {
    return Object.fromEntries(this.db.prepare('SELECT state, COUNT(*) AS total FROM outbox GROUP BY state').all().map(row => [row.state, row.total]));
  }
}
