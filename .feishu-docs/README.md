# 飞书接口与权限索引

本目录里的 Markdown 是从飞书开放平台官方文档下载的原文（`<文档地址>.md`），
用来核对请求参数、响应字段、错误码和权限要求。它们**只是参考**，
插件行为以 `lib/feishu.mjs` 为准。

## 已下载的文档

| 文件 | 对应接口 / 主题 | 官方链接 |
|---|---|---|
| `tenant_token.md` | 自建应用获取 `tenant_access_token` | https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal |
| `oauth_code.md` | 获取授权码（跳转授权页，拿 `code`） | https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code |
| `user_access_token_v3.md` | 用 `code` 换 `user_access_token`（v3） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3 |
| `refresh_v3.md` | 刷新 `user_access_token`（v3） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token-v3 |
| `user_access_token.md` | 换 token 的 v2 版本（历史，含字段说明） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token |
| `refresh_token.md` | 刷新 token 的 v2 版本（历史） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token |
| `authen_v1_access_token.md` | 换 token 的 v1 版本（历史，`app_access_token` 版） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/access_token/create |
| `tasks.md` | 列取任务（「我负责的」） | https://open.feishu.cn/document/task-v2/task/list |
| `tasklists.md` | 获取清单列表 | https://open.feishu.cn/document/task-v2/tasklist/list |
| `tasklist_tasks.md` | 获取清单任务列表 | https://open.feishu.cn/document/task-v2/tasklist/tasks |
| `chats.md` | 获取机器人所在群列表 | https://open.feishu.cn/document/server-docs/group/chat/list |
| `messages.md` | 获取会话历史消息 | https://open.feishu.cn/document/server-docs/im-v1/message/list |
| `chat_members.md` | 获取群成员列表（昵称） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat-members/get |
| `user_info.md` | 获取用户信息（`open_id` / 姓名 / 头像） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/authen-v1/user_info/get |
| `message_resource.md` | 获取消息中的资源文件（图片 / 文件） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-resource/get |

重新下载某一篇（官方文档支持在地址后加 `.md`）：

```powershell
node -e "fetch('https://open.feishu.cn/document/task-v2/task/list.md').then(r=>r.text()).then(t=>require('fs').writeFileSync('tasks.md',t))"
```

## 插件用到的接口与凭证

| 用途 | 请求 | 凭证 | 权限 |
|---|---|---|---|
| 机器人 token | `POST /open-apis/auth/v3/tenant_access_token/internal` | app id + secret | 无 |
| 换用户 token | `POST https://accounts.feishu.cn/oauth/v3/token`（`grant_type=authorization_code`） | client_id + secret + code | 无 |
| 刷新用户 token | 同上，`grant_type=refresh_token` | client_id + secret + refresh_token | `offline_access` |
| 我负责的任务 | `GET /open-apis/task/v2/tasks?type=my_tasks` | **user token** | `task:task:read` |
| 清单列表 | `GET /open-apis/task/v2/tasklists` | tenant 或 user | `task:tasklist:read` |
| 清单内任务 | `GET /open-apis/task/v2/tasklists/{guid}/tasks` | tenant 或 user | `task:tasklist:read` |
| 完成任务 | `PATCH /open-apis/task/v2/tasks/{guid}` | user token | `task:task:write` |
| 机器人所在群 | `GET /open-apis/im/v1/chats` | tenant token | `im:chat:readonly` / `im:chat` |
| 群聊历史 | `GET /open-apis/im/v1/messages?container_id_type=chat` | tenant 或 user，且机器人在群内 | `im:message:readonly` + `im:message.group_msg` |
| 群成员昵称 | `GET /open-apis/im/v1/chats/{chat_id}/members` | **tenant token**（操作者必须在群内） | `im:chat:readonly` / `im:chat` / `im:chat.members:read` |
| 当前登录用户 | `GET /open-apis/authen/v1/user_info` | user token | 无 |
| 消息资源（图片/文件） | `GET /open-apis/im/v1/messages/{id}/resources/{key}?type=image\|file` | tenant token，且机器人在群内 | `im:message:readonly` / `im:message` |

> 后三项都是聊天视图需要的：昵称、自己的 `open_id`（决定哪条消息靠右）、图片和文件字节。
> 它们的权限要求都已经被现有 `REQUIRED_SCOPES` 覆盖，**不需要重新授权**。
> 群成员接口用 **tenant token**：它要求操作者在群内，而这些群本来就是机器人的群，
> 用 user token 会以 `232011`（操作者不在群内）失败。

## 常见错误码

`lib/feishu.mjs` 的 `ERROR_HINTS` 会把下面这些翻译成中文并附上修复建议；
面板会直接把这个提示显示出来。

| 错误码 | 含义 | 处理 |
|---|---|---|
| `20005` | app_id / app_secret 不正确 | 检查设置里的凭证 |
| `20010` | 用户没有应用使用权限 | 开发者后台把该用户加入可用范围 |
| `20037` | refresh_token 过期 | 重新授权一次 |
| `230002` | 机器人不在该群 | 把机器人拉进群 |
| `230006` / `232025` | 应用未开启机器人能力 | 应用能力 → 添加「机器人」并发布 |
| `230013` | 目标用户不在机器人可用范围 | 调整可用范围并发布 |
| `230027` | 权限不足 | 权限管理里开通并发布对应权限 |
| `230073` | 话题对新成员不可见 | 群未开启「新成员可查看历史消息」 |
| `231203` | 群类型不支持取消息 | 例如群开了保密模式 |
| `232004` | app_id 不存在 | 检查 App ID |
| `232011` | 操作者不在该群（成员列表 / 历史消息） | 该群要机器人操作：插件对 `prefer: auto` 的调用会自动回退到 tenant token；若两个 token 都失败，说明机器人确实不在群里 |
| `232034` | 应用未在本租户安装/启用 | 先在管理后台安装应用 |
| `1470400` | 请求参数错误 | 通常是分页参数非法 |

完整错误码见各篇文档里的「错误码」小节与
[服务端通用错误码](https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN)。
