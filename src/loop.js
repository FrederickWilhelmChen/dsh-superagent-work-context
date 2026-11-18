import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { discoverMeetingLinks } from './feishu.js';
import { dispatch, review } from './review.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

async function forEachBounded(rows, work, signal) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      signal.throwIfAborted();
      const index = cursor++;
      await work(rows[index]);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(3, rows.length) }, worker));
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}

export async function sync({ store, feishu, settings, now, signal }) {
  const scan = Math.floor(now() / 1000) * 1000;
  const gaps = [];
  const previousGroups = new Set(store.groups().map(group => group.id));
  store.setGroups(await feishu.groups());
  const groups = store.groups();
  const authors = new Map();
  const record = item => store.append(item, discoverMeetingLinks(item));
  async function collect(id, kind, source, work) {
    try {
      await work();
    } catch (error) {
      signal.throwIfAborted();
      gaps.push({ id, kind, source, error: String(error.message ?? error).slice(0, 500) });
    }
  }
  await forEachBounded(groups, async group => {
    const key = `group-members:${group.id}`;
    let known = store.meta(key);
    if (!known || scan - known.scan >= DAY) {
      await collect(key, 'members', group.id, async () => {
        known = { scan, values: await feishu.members(group.id) };
        store.setMeta(key, known);
      });
    }
    const names = new Map(Object.entries(known?.values ?? {}));
    authors.set(group.id, names);
    await collect(group.id, 'group', group.id, async () => {
      const start = group.cursor === null || !previousGroups.has(group.id)
        ? scan - settings.bootstrapDays * DAY : group.cursor - 2 * HOUR;
      for await (const item of feishu.messages(group.id, start, scan, names)) {
        signal.throwIfAborted();
        store.atomic(() => record(item));
      }
      store.finishGroup(group.id, scan);
    });
  }, signal);

  const topics = store.threads(settings.threadLimit);
  await forEachBounded(topics, async ({ id, source }) => {
    await collect(id, 'thread', source, async () => {
      for await (const item of feishu.thread(source, id, authors.get(source))) {
        signal.throwIfAborted();
        store.atomic(() => record(item));
      }
    });
    // Rotate failed threads too so an inaccessible old thread cannot starve other threads.
    store.finishThread(id, scan);
  }, signal);

  const visited = new Set();
  while (true) {
    const materials = store.materials().filter(item => !visited.has(item.id));
    if (!materials.length) break;
    await forEachBounded(materials, async item => {
      visited.add(item.id);
      const origin = store.latest(item.origin);
      if (!origin || origin.deleted) return;
      await collect(item.id, 'material', item.source, async () => {
        const evidence = await feishu.material(item);
        signal.throwIfAborted();
        store.atomic(() => record({ ...evidence, at: origin.at }));
      });
      if (item.kind === 'minutes') {
        await collect(`${item.id}:transcript`, 'transcript', item.source, async () => {
          const evidence = await feishu.transcript(item);
          signal.throwIfAborted();
          store.atomic(() => record({ ...evidence, at: origin.at }));
        });
      }
    }, signal);
  }

  const coverage = gaps.sort((a, b) => a.id.localeCompare(b.id));
  store.setMeta('coverage', { scan, gaps: coverage });
  return { groups: store.groups(), coverage };
}

export function snapshot(store, dir) {
  const view = store.view();
  const references = new Set(view.context.facts.concat(view.context.actions).flatMap(item => item.evidence));
  const sources = Object.fromEntries([...references].sort().map(id => [id, store.latest(id).url]));
  const coverage = store.meta('coverage');
  const output = {
    ...view, sources, coverage: {
      scan: coverage?.scan ? new Date(coverage.scan).toISOString() : null,
      groups: store.groups(),
      gaps: coverage?.gaps ?? [],
      highwater: store.highwater(),
      receipts: store.receiptCounts(),
      unresolvedAttachments: store.unresolvedAttachments(),
      lastError: store.meta('lastError') ?? null,
    },
  };
  const lines = [view.context.summary, '', 'Open actions'];
  for (const action of view.context.actions.filter(item => item.status !== 'closed')) {
    lines.push(`[${action.status}] ${action.topic} — ${action.next}`, sources[action.trigger ?? action.evidence[0]], '');
  }
  lines.push('Known facts');
  for (const fact of view.context.facts) lines.push(`${fact.topic} — ${fact.fact}`, sources[fact.evidence[0]]);
  lines.push('', 'Coverage', `Last sync: ${output.coverage.scan ?? 'unavailable'}`,
    ...output.coverage.gaps.map(gap => `[${gap.kind}] ${gap.id} — ${gap.error}`));
  writeSnapshot(dir, 'current.json', JSON.stringify(output, null, 2) + '\n');
  writeSnapshot(dir, 'current.txt', lines.join('\n') + '\n');
}

function writeSnapshot(dir, name, text) {
  const temp = join(dir, `.${name}-${randomUUID()}.tmp`);
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, join(dir, name));
}

export async function runCycle({ store, dir, feishu, llm, route, settings, identity, now = Date.now, signal }) {
  try {
    const { groups, coverage } = await sync({ store, feishu, settings, now, signal });
    const view = await review({ store, llm, route, groups, coverage, identity, now, signal,
      ownerId: settings.ownerId, ownerName: settings.ownerName });
    if (settings.deliverPrivate) {
      await dispatch({ store, feishu, view, coverage, now, signal, ownerId: settings.ownerId });
    }
    store.setMeta('lastError', null);
    return view;
  } catch (error) {
    if (!signal.aborted) store.setMeta('lastError', { at: new Date(now()).toISOString(), message: String(error.message ?? error).slice(0, 500) });
    throw error;
  } finally {
    if (!signal.aborted) snapshot(store, dir);
  }
}
