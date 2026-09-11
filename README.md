# dsh-feishu-plugin

[中文](README.md) · [English](README.en.md)

把飞书任务和机器人所在群聊带进 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) Web：查看任务、阅读群消息、用模型总结待办，并把需要继续处理的内容一键放进当前对话输入框。

> 这是 DSH 的第三方插件，需要已经能正常运行的 `dsh web`。Node.js 版本需为 20 或更高。

如果终端提示找不到 `dsh`，这是正常的：它不是本仓库提供的命令，而是独立包 `@deepseek-ai/dsh` 的 CLI。无需全局安装也可以使用：

```powershell
npx @deepseek-ai/dsh plugin --profile web add D:\desktop\repos\dsh-feishu-plugin
```

经常使用 DSH 时再考虑全局安装：

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile web add D:\desktop\repos\dsh-feishu-plugin
```

注意参数顺序是 `dsh plugin --profile web add <路径>`，不是 `dsh plugin add --profile web <路径>`。下文的 `apply-profile.mjs` 是本仓库提供的等效安装方式，适合在克隆后的仓库里开发和验证。

## 能做什么

- **我的任务**：查看飞书任务；需要用户授权后可读取“我负责的”任务。
- **群聊总结**：读取机器人已加入的群聊及消息，按聊天记录展示，并生成摘要、关键点和待办。
- **继续交给模型**：任务、消息和待办都可以“加入输入框”。这只会追加草稿，**不会自动发送**。
- **完成任务**：点击“完成”会直接更新飞书中的任务状态，不是仅在本地隐藏。
- **模型工具**：默认提供 `feishu_tasks` 和 `feishu_summarize`，可在 DSH 对话中供模型调用。

## 5 分钟开始使用

### 1. 安装到 DSH

在仓库根目录运行：

```powershell
# 链接 DSH 运行时依赖；可安全重复执行
node scripts/bootstrap-deps.mjs

# 安装前自检
node scripts/check.mjs

# 写入 DSH 的 web profile；会先备份原配置
node scripts/apply-profile.mjs
```

然后重启 `dsh web` 并刷新浏览器。首次安装必须重启；以后改 `lib/index.js` 也需要重启，改 `lib/client.js` 刷新页面即可。

如需预览而不修改配置，使用：

```powershell
node scripts/apply-profile.mjs --dry-run
```

详细的安装、隔离验证和自定义 DSH 路径说明见 [docs/install.md](docs/install.md)。

### 2. 创建并配置飞书应用

在[飞书开发者后台](https://open.feishu.cn/app)创建“企业自建应用”，完成以下事项：

1. 添加并发布**机器人**能力。
2. 在“权限管理”中申请并发布下列权限。
3. 将应用发布，并把自己加入可用范围。

| 权限 | 用途 | 是否必需 |
| --- | --- | --- |
| `im:chat:readonly` | 获取机器人所在的群 | 是 |
| `im:message:readonly` | 读取消息 | 是 |
| `im:message.group_msg` | 读取群内所有消息 | 是，群聊总结 |
| `task:tasklist:read` | 读取任务清单 | 是，任务列表 |
| `task:task:read` | 读取“我负责的”任务 | 是，登录后 |
| `task:task:write` | 完成或恢复任务 | 是，使用完成按钮时 |
| `offline_access` | 获得刷新令牌，保持登录 | 建议 |

如果之后才新增权限，需要在插件中**重新授权**，已有令牌不会自动拥有新权限。

### 3. 填入 App ID 和 App Secret

重启后，在 DSH 中打开：**设置 → 插件 → 插件配置 → feishu-plugin**，填入飞书应用的 App ID 与 App Secret 并保存。

也可以命令行配置：

```powershell
node scripts/apply-settings.mjs --app-id cli_xxx --app-secret your_secret
node scripts/apply-settings.mjs --show
```

配置会写入 `$DSH_HOME/settings.yaml` 的 `feishu-plugin` 段，并且热加载，无需再次重启。密钥不会通过读取接口或设置表单回显。

## 在 DSH 里怎么用

点击左侧边栏底部的“飞书”：

| 位置 | 你能做什么 |
| --- | --- |
| 会话内 | 打开右侧“飞书”面板；“加入输入框”可把内容追加到当前对话草稿。 |
| 首页 | 打开完整飞书页面；可以看任务和群聊，但没有当前会话输入框可插入。 |

在面板中：

1. **我的任务**：先查看任务清单；若要查看“我负责的”任务或完成任务，点击“登录飞书”完成一次授权。
2. **群聊总结**：选择一个机器人已在其中的群，先看消息记录，或点击生成 AI 摘要和待办。
3. 需要让模型继续处理时，点击任意任务、消息或待办旁的“加入输入框”，再自行检查并发送。

“加入输入框”插入的内容刻意很短：任务只插**一行** `- [ ] 任务名（截止 …）[清单: …]`，消息插一行 `> [HH:mm]昵称: 内容` 这样的引用行。任务的**描述不会插入**——agent 建的任务常把会议、优先级、妙记 token、来源 uuid 全塞进描述里，整段贴进输入框会把你要办的那句话淹掉；描述在飞书里原本就在，面板行上也不显示。

## 为什么有时需要登录飞书

只配置 App ID / App Secret 后，插件就能以机器人身份读取任务清单与机器人所在群聊。以下操作必须使用你的 `user_access_token`：

- 读取“我负责的”任务；
- 完成或恢复任务。

授权通常只需一次。令牌过期后插件会尝试自动刷新。

### 授权回调的复制粘贴方式

飞书要求 OAuth 重定向地址预先加入应用白名单，且常常不接受本机 `127.0.0.1` 地址。若你的应用回调地址是已有的公网地址，按下面做：

1. 在插件配置的 `oauthRedirectUri` 中填写该白名单地址。
2. 点“打开授权页”，在飞书完成授权。
3. 浏览器跳转到回调地址后，将**完整地址栏 URL**复制到插件的授权区，点“用回调地址兑换”。

即使回调页面本身报错也不影响这一步：只要 URL 中还有 `code`，就可以兑换。授权码有效期短且只能使用一次，建议立即粘贴。

## 常用配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `appId` / `appSecret` | 空 | 飞书应用凭证，必填 |
| `baseUrl` | `https://open.feishu.cn` | Lark 国际版使用 `https://open.larksuite.com` |
| `oauthRedirectUri` | 空 | 必须与飞书后台白名单完全一致 |
| `maxMessages` | `200` | 每次总结读取的消息数，范围 10–2000 |
| `summaryProvider` / `summaryModel` | 空 | 留空时使用 DSH 当前默认模型 |
| `toolsEnabled` | `true` | 是否提供两个模型工具 |

命令行修改单项示例：

```powershell
node scripts/apply-settings.mjs --set "maxMessages=300"
node scripts/apply-settings.mjs --set "baseUrl=https://open.larksuite.com"
```

**注意：设置表单或命令中留空表示“不修改”，不是清空配置。** 如要移除一个已写入的值，请直接编辑 `$DSH_HOME/settings.yaml`。

## 常见问题

### 看不到群聊或消息

确认机器人能力已发布、机器人已被加入目标群，并已申请 `im:chat:readonly`、`im:message:readonly` 和 `im:message.group_msg`。群聊历史只会读取机器人所在群。

### 任务区没有“我负责的”任务

先点击“登录飞书”完成用户授权，并确认已发布 `task:task:read`。未登录时插件会退回到任务清单，这属于正常行为。

### 点击“完成”失败

这项操作会写入飞书，必须用户登录并拥有 `task:task:write`。权限后来补开时，请重新授权。

### 应用说重定向地址不合法

检查 `oauthRedirectUri` 与飞书后台“安全设置 → 重定向 URL”是否逐字符一致。不能使用本机地址时，改用已备案的公网回调地址并走上面的复制粘贴兑换流程。

### 设置保存后没有生效

用 `node scripts/apply-settings.mjs --show` 确认写入位置和内容；如果刚刚安装插件，请先重启一次 `dsh web`，使插件的设置区注册完成。

## 开发与验证

```powershell
node scripts/check.mjs              # 语法、依赖和测试
node scripts/panel-check.mjs        # 在隔离的 DSH home 中验证插件装载和接口
node scripts/panel-check.mjs --ui   # 额外尝试无头浏览器 UI 验证
```

开发时可启动本地假飞书服务，不需要真实租户：

```powershell
node scripts/stub-feishu.mjs 3098
```

项目的 HTTP 接口位于同源路径 `/plugin/feishu/api/*`；源码职责划分和完整安装接线请查看 [docs/install.md](docs/install.md) 与 `lib/` 目录注释。

## 已知限制

- 暂不支持飞书话题（thread）消息，只读取群主会话。
- 前端最多显示最近 300 条消息；后端单次读取上限仍可由 `maxMessages` 调到 2000。
- 其他成员通常显示为稳定首字母头像；真实头像需要额外的通讯录权限。
- 模型工具是否会出现在某个会话中还取决于该 DSH 组合的 Agent preset 配置。

## 许可证

MIT
