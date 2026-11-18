import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import schema from '@deepseek-ai/schemastery';
import lockfile from 'proper-lockfile';
import { createFeishu } from './feishu.js';
import { Store } from './store.js';
import { runCycle } from './loop.js';
import { importLegacy } from './legacy.js';

export const name = 'dsh-superagent-work-context';
export const inject = ['orchestrator', 'llm'];

export const Config = schema.object({
  enabled: schema.boolean().default(false).description('Run background synchronization and analysis.'),
  deliverPrivate: schema.boolean().default(false).description('Deliver evidence-backed reminders to the configured owner.'),
  ownerId: schema.string().description('The only recipient, as an open_id bound to the SuperAgent bot app.'),
  ownerName: schema.string().description('The name used to recognize the owner in human conversation.'),
  stateDir: schema.string().description('Absolute path. Defaults to work-context inside the SuperAgent state directory.'),
  legacyDb: schema.string().description('Optional absolute path to the old Python global-context SQLite database. Imported once, read-only.'),
  intervalMinutes: schema.number().min(1).max(1440).step(1).default(30),
  bootstrapDays: schema.number().min(1).max(30).step(1).default(14),
  threadLimit: schema.number().min(1).max(300).step(1).default(120),
  provider: schema.string().default('deepseek-official'),
  model: schema.string().default('deepseek-flash'),
});

export function apply(ctx, settings) {
  if (settings.deliverPrivate && !settings.enabled) throw new Error('Enable work context before enabling delivery');
  if (!settings.enabled) return;
  if (!/^ou_[A-Za-z0-9]+$/.test(settings.ownerId) || !settings.ownerName?.trim()) {
    throw new Error('Work context requires an owner open ID and name');
  }
  if (settings.stateDir && !isAbsolute(settings.stateDir)) throw new Error('stateDir must be absolute');
  if (settings.legacyDb && !isAbsolute(settings.legacyDb)) throw new Error('legacyDb must be absolute');

  ctx.effect(() => {
    const stopped = new AbortController();
    const running = service(ctx, settings, stopped).catch(error => {
      if (!stopped.signal.aborted) ctx.logger.error('Work context could not start: %s', error.message);
    });
    return async () => {
      stopped.abort();
      await running;
    };
  }, 'SuperAgent work context');
}

async function service(ctx, settings, stopped) {
  const { signal } = stopped;
  const host = ctx.orchestrator.context({ kind: name, health: [] });
  await host.ready;
  signal.throwIfAborted();
  if (!host.configured()) throw new Error('Configure the SuperAgent deployment first');
  const { feishu: bot, stateDir } = host.deployment;
  if (!bot) throw new Error('Configure the SuperAgent Feishu Source bot first');
  const dir = settings.stateDir ?? join(stateDir, 'work-context');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(dir, {
    stale: 120000,
    update: 10000,
    onCompromised(error) {
      ctx.logger.error('Work-context state lock compromised: %s', error.message);
      stopped.abort(error);
    },
  });
  try {
    const store = new Store(join(dir, 'context.sqlite3'));
    try {
      const identity = [bot.appId, bot.botId, settings.ownerId];
      store.bindIdentity(identity);
      const feishu = createFeishu(host.commands.withSignal(signal), bot.brand);
      if (settings.legacyDb && !store.meta('legacyImported')) {
        const groups = await feishu.groups();
        signal.throwIfAborted();
        importLegacy({ store, path: settings.legacyDb, identity, groups });
      }
      const interval = settings.intervalMinutes * 60000;
      ctx.logger.info('SuperAgent work context enabled (%d minute interval, delivery=%s)', settings.intervalMinutes, settings.deliverPrivate);
      while (!signal.aborted) {
        const start = Date.now();
        try {
          await runCycle({ store, dir, feishu, llm: ctx.llm, route: {
            provider: settings.provider, model: settings.model,
          }, settings, identity, signal });
        } catch (error) {
          if (!signal.aborted) ctx.logger.warn('SuperAgent work-context cycle failed: %s', error.message);
        }
        if (!signal.aborted) await delay(Math.max(0, start + interval - Date.now()), undefined, { signal });
      }
    } finally {
      store.close();
    }
  } finally {
    await release();
  }
}
