/**
 * The plugin's optional model-facing tools.
 *
 * Tools live in the agent plane, which the web surface delegates to agent
 * presets, so whether a host-plane registration is visible to a session is a
 * composition fact this plugin cannot assert. Registration therefore stays
 * best-effort and switchable, and never blocks the panel.
 *
 * @module dsh-feishu-plugin/plugin/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { summarizeChat } from '../summary.mjs';
import { toErrorPayload } from './support.mjs';

/**
 * Register the tools when the composition has a tool seat and they are enabled.
 *
 * @param {object} deps - tool dependencies.
 * @param {any} deps.ctx - plugin context.
 * @param {any} deps.logger - plugin logger.
 * @param {() => any} deps.current - live plugin config.
 * @param {(options: any) => Promise<any>} deps.readTranscript - transcript read.
 * @param {() => any} deps.resolveSelection - model selection.
 */
export function registerTools({ ctx, logger, current, readTranscript, resolveSelection }) {
  // ── model-facing tools (optional) ─────────────────────────────────────────
  // Tools live in the agent plane, which the web surface delegates to agent
  // presets; whether a host-plane registration is visible to a session is a
  // composition fact this plugin cannot assert. Registration therefore stays
  // best-effort and switchable, and never blocks the panel.
  ctx.inject(['tools'], (toolCtx) => {
    if (current().toolsEnabled === false) return;
    ctx.effect(() => {
      const disposers = [];
      const renderText = (text) => [{ type: 'text', text }];
      try {
        disposers.push(toolCtx.tools.register(defineTool({
          name: 'feishu_tasks',
          description: '列出当前飞书账号的任务。已登录时返回「我负责的」未完成任务，否则返回应用可读的任务清单中的任务。',
          parameters: {
            limit: { type: 'number', description: '最多返回多少条任务，默认 20。' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: true,
              properties: {
                source: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
            render: (_args, value) => renderText(value.content),
          },
          isConcurrencySafe: () => true,
          async execute(args) {
            const limit = Math.min(100, Math.max(1, Number(args?.limit ?? 20)));
            const result = await readTasks({ force: true });
            const slice = result.items.slice(0, limit);
            const lines = slice.map((task, index) => {
              const due = task.due === undefined ? '无截止时间' : new Date(task.due).toISOString().slice(0, 10);
              const list = task.tasklistName === undefined ? '' : ` [清单: ${task.tasklistName}]`;
              return `${index + 1}. ${task.title}（截止 ${due}）${list}`;
            });
            return {
              source: result.source,
              content: [
                result.source === 'my_tasks' ? '来源：飞书「我负责的」任务' : '来源：应用可读的任务清单',
                result.notice ?? '',
                lines.length === 0 ? '（没有未完成任务）' : lines.join('\n'),
              ].filter((line) => line.length > 0).join('\n'),
            };
          },
        })));
        disposers.push(toolCtx.tools.register(defineTool({
          name: 'feishu_summarize',
          description: '读取某个飞书群最近 N 小时的聊天记录，用模型总结要点并提取待办任务。群列表可用 feishu_chats 之外的渠道获取；不确定群 ID 时先让用户从侧边栏复制。',
          parameters: {
            chatId: { type: 'string', required: true, description: '群 ID（oc_ 开头）。' },
            hours: { type: 'number', description: '总结最近多少小时，默认 24。' },
            limit: { type: 'number', description: '最多读取多少条消息，默认 200。' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: true,
              properties: { content: { type: 'string', required: true } },
            },
            render: (_args, value) => renderText(value.content),
          },
          isConcurrencySafe: () => true,
          async execute(args, exec) {
            const transcript = await readTranscript({
              chatId: args?.chatId,
              hours: Number(args?.hours ?? 24),
              limit: Number(args?.limit ?? 200),
            });
            const summary = await summarizeChat({
              llm: ctx.get('llm'),
              input: {
                chatName: transcript.chatName,
                transcript: transcript.transcript,
                messageCount: transcript.messageCount,
                truncated: transcript.truncated,
              },
              selection: resolveSelection(),
              signal: exec?.signal,
            });
            const items = summary.actionItems.map((item, index) => `${index + 1}. ${item.title}${item.owner.length > 0 ? `（负责人 ${item.owner}）` : ''}${item.due.length > 0 ? `（截止 ${item.due}）` : ''}`);
            return {
              content: [
                `群：${transcript.chatName}（${transcript.messageCount} 条消息${transcript.truncated ? '，已截断' : ''}）`,
                '',
                summary.summary,
                summary.keyPoints.length === 0 ? '' : `\n关键点：\n${summary.keyPoints.map((point) => `- ${point}`).join('\n')}`,
                items.length === 0 ? '\n（没有识别出待办）' : `\n待办：\n${items.join('\n')}`,
                summary.warning === undefined ? '' : `\n注意：${summary.warning}`,
              ].filter((line) => line.length > 0).join('\n'),
            };
          },
        })));
        logger.info('feishu model tools registered');
      } catch (error) {
        logger.warn('model tool registration failed', toErrorPayload(error).message);
      }
      return () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose();
          } catch (error) {
            logger.debug('tool disposer failed', toErrorPayload(error).message);
          }
        }
      };
    }, 'feishu-plugin: model tools');
  });
}
