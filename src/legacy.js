import { DatabaseSync } from 'node:sqlite';
import { discoverMeetingLinks } from './feishu.js';
import { hash } from './store.js';

export function importLegacy({ store, path, identity, groups }) {
  if (store.meta('legacyImported')) return;
  if (store.highwater() || store.view().revision) throw new Error('Import the legacy database before the first native sync');
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    source.exec('BEGIN');
    const view = source.prepare('SELECT * FROM versions ORDER BY rev DESC LIMIT 1').get();
    if (!view) throw new Error('Legacy work context has no reviewed version');
    const context = JSON.parse(view.body);
    const scan = Date.parse(source.prepare("SELECT value FROM meta WHERE key = 'scan'").get()?.value);
    if (!Number.isFinite(scan)) throw new Error('Legacy work context has no valid scan time');
    const owner = identity[2];
    if (context.actions.some(action => ['follow_up', 'operate', 'approve'].includes(action.status) && action.owner !== owner)) {
      throw new Error('Legacy work-context owner does not match plugin configuration');
    }

    const memberships = new Set(groups.map(group => group.id));
    const legacyGroups = source.prepare('SELECT id, name FROM groups WHERE active = 1').all().filter(group => memberships.has(group.id));
    const legacySources = new Set(legacyGroups.map(group => group.id));
    const evidence = source.prepare('SELECT * FROM evidence ORDER BY seq').all().map(row => ({ ...row, body: JSON.parse(row.body) }));
    const documents = source.prepare('SELECT * FROM materials').all();
    const messages = evidence.filter(row => legacySources.has(row.source));
    const origins = new Map(messages.map(row => [row.id, row.source]));
    const known = new Map(documents.map(doc => {
      const via = doc.origin.startsWith('om_') ? undefined
        : messages.find(row => row.body.text.includes(doc.url));
      return [doc.id, { id: doc.id, kind: doc.kind, url: doc.url, origin: via?.id ?? doc.origin }];
    }));
    for (const doc of known.values()) {
      let current = doc.origin;
      const seen = new Set([doc.id]);
      while (!origins.has(current) && known.has(current) && !seen.has(current)) {
        seen.add(current);
        current = known.get(current).origin;
      }
      doc.source = origins.get(current);
    }

    store.setGroups(groups);
    store.atomic(() => {
      const cursor = source.prepare('SELECT value FROM meta WHERE key = ?');
      for (const group of legacyGroups) {
        const at = Date.parse(cursor.get(group.id)?.value);
        if (Number.isFinite(at)) store.finishGroup(group.id, at);
      }
      let importedThrough = 0;
      for (const row of evidence) {
        const body = row.body;
        const doc = known.get(row.id);
        let record;
        if (row.source === 'document' && doc?.source) {
          record = { id: row.id, source: doc.source, kind: 'document', text: body.text, url: doc.url,
            origin: doc.origin, title: body.title };
        } else if (legacySources.has(row.source)) {
          record = { id: row.id, source: row.source, kind: 'message', at: Date.parse(body.time),
            author: body.author ?? body.sender, sender: body.sender, human: body.type === 'user',
            mentions: [], deleted: body.deleted === true, thread: body.thread ?? undefined,
            text: body.text, url: body.url };
        }
        if (!record) continue;
        store.append({ ...record, legacy: true }, discoverMeetingLinks(record));
        if (row.seq <= view.through_seq) importedThrough = store.highwater();
      }
      const material = store.db.prepare('INSERT OR IGNORE INTO materials VALUES (?, ?, ?)');
      for (const doc of known.values()) {
        if (doc.source) material.run(doc.id, doc.source, JSON.stringify(doc));
      }
      const checkpoint = source.prepare('SELECT id, checked FROM topics').all();
      for (const row of checkpoint) {
        const checked = Date.parse(row.checked);
        if (Number.isFinite(checked)) store.finishThread(row.id, checked);
      }
      const exists = id => Boolean(store.latest(id));
      const facts = context.facts.flatMap(fact => {
        const refs = fact.evidence.filter(exists);
        return refs.length ? [{ ...fact, key: `legacy-${hash(fact.topic + '\n' + fact.fact).slice(0, 24)}`, evidence: refs }] : [];
      });
      const actions = context.actions.flatMap(action => {
        const refs = action.evidence.filter(exists);
        if (!refs.length) return [];
        if (action.trigger && !refs.includes(action.trigger)) {
          const { trigger, ...waiting } = action;
          return [{ ...waiting, status: 'waiting', evidence: refs }];
        }
        return [{ ...action, evidence: refs }];
      });
      store.db.prepare('INSERT INTO views VALUES (?, ?, ?)').run(1, importedThrough,
        JSON.stringify({ summary: context.summary, facts, actions }));
      const insert = store.db.prepare('INSERT OR IGNORE INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const row of source.prepare("SELECT * FROM outbox WHERE state = 'sent' OR (state = 'pending' AND attempted IS NOT NULL)").iterate()) {
        const value = JSON.parse(row.body);
        const { key, trigger, status } = value;
        const id = hash(JSON.stringify([identity, key, status, trigger])).slice(0, 48);
        insert.run(id, key, trigger, JSON.stringify({ id, key, trigger, status }), Date.parse(row.attempted) || null,
          row.receipt, row.state === 'sent' ? 'sent' : 'uncertain');
      }
      store.setMeta('legacyImported', { revision: view.rev, through: view.through_seq, scan });
    });
  } finally {
    source.close();
  }
}
