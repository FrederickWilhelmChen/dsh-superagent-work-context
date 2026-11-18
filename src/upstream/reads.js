// Adapted from zjuatri/dsh-feishu-plugin lib/feishu/api.mjs (MIT).
export function createFeishuReads(transport) {
  /**
   * List the chats the bot is in.
   * @param {string | undefined} pageToken - continuation token.
   * @returns {Promise<{ items: any[], hasMore: boolean, pageToken: string | undefined }>} raw chat rows.
   */
  async function listChatPage(pageToken) {
    const payload = await transport.getJson('/open-apis/im/v1/chats', {
      what: 'List bot groups',
      prefer: 'tenant',
      query: { page_size: 100, page_token: pageToken, sort_type: 'ByCreateTimeAsc' },
    });
    const { data } = payload;
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') {
      throw new Error('Invalid Feishu list response');
    }
    return {
      items: data.items,
      hasMore: data.has_more === true,
      pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
    };
  }

  /**
   * Read one page of chat history.
   * @param {{ chatId?: string, threadId?: string, startTime?: number, endTime?: number, pageSize?: number, pageToken?: string, order?: 'asc' | 'desc' }} options - request options.
   * @returns {Promise<{ items: any[], hasMore: boolean, pageToken: string | undefined }>} raw messages.
   */
  async function listMessages(options) {
    const payload = await transport.getJson('/open-apis/im/v1/messages', {
      what: 'Read group history',
      prefer: 'tenant',
      query: {
        container_id_type: options.threadId ? 'thread' : 'chat',
        container_id: options.threadId ?? options.chatId,
        start_time: options.startTime === undefined ? undefined : String(Math.floor(options.startTime / 1000)),
        end_time: options.endTime === undefined ? undefined : String(Math.floor(options.endTime / 1000)),
        sort_type: options.order === 'desc' ? 'ByCreateTimeDesc' : 'ByCreateTimeAsc',
        page_size: Math.min(50, options.pageSize ?? 50),
        page_token: options.pageToken,
      },
    });
    const { data } = payload;
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') {
      throw new Error('Invalid Feishu list response');
    }
    return {
      items: data.items,
      hasMore: data.has_more === true,
      pageToken: typeof data.page_token === 'string' ? data.page_token : undefined,
    };
  }

  return { listChatPage, listMessages };
}
