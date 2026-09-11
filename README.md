# dsh-feishu-plugin

[中文](README.md) · [English](README.en.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）第三方插件：

- 在 DSH Web GUI 的**右侧边栏**读取你的**飞书任务**；
- 列出**机器人所在的群聊**，把聊天记录**按聊天软件的样子显示**（头像、昵称、气泡、日期分隔、引用、图片），
  再用 **DeepSeek 一键总结**，自动提取待办任务；
- 每条任务/待办旁边有 **「加入输入框」** 按钮，一键把内容追加到当前会话的输入框（不会自动发送）；
- 任务行上的 **「完成」** 按钮会**真的把飞书里的任务标记为完成**（写接口，不是本地隐藏）；
- 额外注册两个模型工具 `feishu_tasks` / `feishu_summarize`，可以在对话里直接让模型读取任务或总结群聊。

入口在**左侧边栏底部**（和「设置」同一行，飞书官方 logo + 「飞书」两个字），
**首页也能看到**——会话标题栏上没有任何按钮：

```
左侧边栏底部「飞书」
├─ 在会话里点  → 右侧边栏打开「飞书」Tab（输入框就在旁边，[加入输入框] 直接可用）
└─ 首页点击    → 中间显示同名的整页视图（任务 / 群聊总结都能用，只是没有输入框可插入）

右侧边栏 Tab「飞书」
├─ 我的任务   ── 任务列表 + [加入输入框] + [完成]
└─ 群聊总结   ── 选群 →（自动拉取）→ 聊天记录 ／ AI 摘要 两个子视图
                ├─ 聊天记录 ── 头像 + 昵称 + 时间 + 气泡 + 日期分隔 + 引用 + 图片缩略图
                └─ AI 摘要   ── 摘要 / 关键点 / 待办任务 + [加入输入框]
```

> 为什么不放在左侧的一堆「面板图标」里？因为**面板图标会切换中间那一列**，而右侧边栏的会话
> 面板只在「对话被选中」时存在——等页面挂载完再想打开右侧 Tab，已经没有会话可以开了。
> 底部这一行是插件自己处理点击的座位，可以先开 Tab、再决定要不要退化成整页视图。

## 快速开始

```powershell
# 1) 把运行时要用的包链接到本仓库（幂等，可重复执行）
node scripts/bootstrap-deps.mjs

# 2) 自检：语法 + 依赖 + 121 个用例
node scripts/check.mjs

# 3) 装进 web profile（会先备份 cordis.patch.yml）
node scripts/apply-profile.mjs

# 4) 重启 dsh web（首次装载必须），然后刷新页面
```

重启刷新后，打开 **设置 → 插件 → 插件配置**，里面有 **feishu-plugin** 卡片，
填 App ID / App Secret 后点保存即可（写入 `$DSH_HOME/settings.yaml`，热加载，不用重启）。
`appSecret` 在 schema 里有 `role('secret')`，任何读接口都不回显，表单里也永远不回填。

> **那张卡片是本插件自己注册的。** DSH 的设置页没有「按 schema 自动生成表单」这一层：
> `settings.plugin.item` 是 keyed 插槽，页面只为**注册了卡片的命名空间**画表单。
> 本插件的浏览器半用 `ctx.settingsScope.bind({ namespace: 'feishu-plugin' })` 绑定自己的
> 命名空间，并以同一个 key 注册卡片——这也是官方为第三方插件留的扩展位。
>
> 不想开 GUI 的话，命令行等价：
>
> ```powershell
> node scripts/apply-settings.mjs --app-id cli_xxx --app-secret yyy
> ```

随时查看当前配置（密钥只显示长度，不回显）：

```powershell
node scripts/apply-settings.mjs --show
```

保存配置时有一条硬规则：**空输入框 = 不修改，绝不等于清空**。每个字段都有 schema 默认值，
已存的值只可能是你亲手填的，所以把空值写回去会静默毁掉配置（重定向 URL 就曾被这样清掉，
直接导致飞书报 20029 / 20063）。要改就填新值。

然后点**左侧边栏底部的「飞书」**（首页也能点，会直接打开整页视图）：

- 任务区会立刻显示**应用可读的清单任务**；
- 想看「我负责的」任务，点「登录飞书」完成一次用户授权（见下文）。

## 为什么需要一次用户授权

飞书不同接口接受的凭证不同，这是接口本身的限制：

| 能力 | 接口 | 接受的凭证 | 权限 |
|---|---|---|---|
| 「我负责的」任务 | `GET /open-apis/task/v2/tasks?type=my_tasks` | **仅** `user_access_token` | `task:task:read` |
| 任务清单 / 清单内任务 | `GET /open-apis/task/v2/tasklists[/{guid}/tasks]` | tenant 或 user | `task:tasklist:read` |
| 完成 / 恢复任务 | `PATCH /open-apis/task/v2/tasks/{guid}` | user token | **`task:task:write`** |
| 机器人所在群列表 | `GET /open-apis/im/v1/chats` | `tenant_access_token`（机器人能力） | `im:chat:readonly` |
| 群聊历史消息 | `GET /open-apis/im/v1/messages` | tenant / user，且**机器人必须在群里** | `im:message:readonly` + `im:message.group_msg` |
| 群成员昵称 | `GET /open-apis/im/v1/chats/{chat_id}/members` | **tenant token**（操作者必须在群内） | `im:chat:readonly` |
| 当前登录用户（`open_id`/姓名/头像） | `GET /open-apis/authen/v1/user_info` | user token | **无** |
| 消息里的图片 / 文件 | `GET /open-apis/im/v1/messages/{id}/resources/{key}` | tenant token | `im:message:readonly` |

所以：**群聊总结只需要机器人 token**（配好凭证就能用）；**「我负责的」任务和「完成」按钮需要
你本人授权一次**。未登录时插件自动回退到清单任务，并在面板上标注来源，不会报错卡住。

聊天视图需要的昵称、图片、以及"哪条消息是我说的"，用的都是上表里**已经申请过的权限**，
所以升级到聊天式界面**不需要重新授权**。

## 授权：为什么需要"复制粘贴"这一步

飞书一个应用只有**一份重定向 URL 白名单**。如果你的应用已经绑定了别的回调地址
（例如自有服务 `https://your-domain/webhooks/feishu/oauth/callback`），那么：

1. 授权页必须带上白名单里的那个地址，否则飞书直接拒绝（**20029**）；
2. 用户同意后，飞书把 `code` 送到**那个地址**，而不是本机 DSH；
3. 所以本机的 DSH 拿不到回调 —— 需要你把地址栏里那条 URL **复制回面板**兑换。

面板的「飞书授权」区块就是为此常驻的：

1. 点 **「打开授权页」**，在飞书里点「授权」；
2. 浏览器跳到回调地址（**页面上会显示报错，忽略它**——服务端没能兑换，但 `code` 还在 URL 里）；
3. 把地址栏里**完整 URL** 复制，粘回面板输入框，点 **「用回调地址兑换」**。

授权码 5 分钟内有效、且只能用一次。兑换成功后 `user_access_token` 与 `refresh_token`
写进 `settings.yaml`，之后过期会自动刷新，不用再走这一步。

如果 dc-agent 之类的自有服务在同一台机器上可以访问到 DSH，那它也能代你转发这个 `code`
（`dc-core` 里有对应实现，靠 OAuth `state` 的 `dsh-feishu-` 前缀识别这类授权）。

## 飞书开发者后台怎么配

1. 在 [开发者后台](https://open.feishu.cn/app) 创建**企业自建应用**。
2. **应用能力 → 添加「机器人」**，并发布版本（否则群列表/消息接口报 `232025`）。
3. **权限管理**里开通并发布：

   | 权限 | 用途 |
   |---|---|
   | `im:chat:readonly`（或 `im:chat`） | 读取机器人所在群列表 |
   | `im:message:readonly` | 读取单聊/群聊消息 |
   | `im:message.group_msg` | 读取群聊中所有消息（群聊历史必需） |
   | `task:task:read` | 读取任务（面板列表） |
   | `task:task:write` | **写**任务——面板上的「完成」按钮会真的改飞书 |
   | `task:tasklist:read` | 读取任务清单 |
   | `offline_access` | 让飞书返回 `refresh_token`，否则授权几小时后失效 |

4. **安全设置 → 重定向 URL**：本插件申请里带的地址必须在这份白名单里。把你的地址填进
   插件的 `oauthRedirectUri`（设置卡片里的「重定向 URL」）即可，例如：

   ```
   https://your-domain/webhooks/feishu/oauth/callback
   ```

   ⚠️ 飞书**不接受** `http://127.0.0.1:...` 这类本地地址，所以 DSH 自己的回调路径
   （`/plugin/feishu/api/auth/callback`）即使填进白名单也可能被拒——这也是要走"复制粘贴"的原因。

5. 把应用**发布**，并把你自己加入**可用范围**（否则授权报 `20010`）。

> 权限是**授权时**固化进 token 的。事后在后台补开权限，必须回插件面板**重新授权一次**，
> 旧 token 不会自动获得新权限（表现为 `99991679`，插件会提示这一点）。

## 配置项

在 **设置 → 插件 → 插件配置 → feishu-plugin** 卡片里改，或命令行：

```powershell
node scripts/apply-settings.mjs --show                        # 查看现值
node scripts/apply-settings.mjs --set "maxMessages=300"       # 改单项
node scripts/apply-settings.mjs --app-id cli_x --app-secret y # 换凭证
```

两者写的是同一个地方：`$DSH_HOME/settings.yaml` 的 `feishu-plugin:` 段（热加载，立即生效）。
也可以在 profile 的 `cordis.patch.yml` 里用 `config:` 给初值——那一层优先级低于用户设置。

| 键 | 默认值 | 说明 |
|---|---|---|
| `appId` / `appSecret` | 空 | 飞书自建应用凭证（必填） |
| `baseUrl` | `https://open.feishu.cn` | 开放平台地址；Lark 国际版填 `https://open.larksuite.com` |
| `oauthTokenUrl` | `https://accounts.feishu.cn/oauth/v3/token` | OAuth 换 token 的端点 |
| `oauthRedirectUri` | 空 | **必须**是后台白名单里的地址；授权与兑换两次请求都会带上 |
| `oauthStatePrefix` | `dsh-feishu-` | OAuth `state` 前缀，供共享回调的自有服务识别 |
| `maxMessages` | `200` | 单次总结最多读取的消息条数（10–2000） |
| `summaryProvider` / `summaryModel` | 空 | 留空则用 DSH 默认模型（当前 `deepseek-official` / `deepseek-flash`） |
| `toolsEnabled` | `true` | 是否注册 `feishu_tasks` / `feishu_summarize` 两个模型工具 |
| `userToken` / `refreshToken` / `userTokenExpiresAt` / `userName` | — | 授权状态，由插件自己维护 |

## 宿主 HTTP 接口

浏览器半只调用这些同源接口（前缀 `/plugin/feishu`，统一返回
`{ok:true,data}` 或 `{ok:false,error:{message,hint,code}}`）：

| 方法与路径 | 作用 |
|---|---|
| `GET /api/state` | 面板所需的全部状态（配置/登录/任务/群列表/模型） |
| `POST /api/tasks/refresh` | 强制刷新任务（绕过 60 秒缓存） |
| `POST /api/tasks/complete` | 完成 / 恢复任务（**写飞书**） |
| `POST /api/chats/refresh` | 强制刷新机器人所在群列表 |
| `POST /api/messages` | 拉取某群最近记录（`chatId` / `hours` / `limit`），返回**给界面用的消息数组** + 给模型用的文本 |
| `POST /api/summarize` | 拉记录 + DeepSeek 总结，返回 `{summary,keyPoints,actionItems}` |
| `GET /api/media` | 转发消息里的图片/文件字节（`messageId` + `fileKey` + `type`），供 `<img>` 直接用 |
| `POST /api/auth/url` | 生成飞书授权页链接 |
| `POST /api/auth/complete` | 用授权码或回调 URL 换取 token |
| `POST /api/auth/logout` | 清除本地授权状态 |
| `GET /api/auth/callback` | OAuth 回调（重定向 URL 可用时） |

「刷新」按钮跟随当前标签：任务页刷任务；群聊页**同时刷群列表和当前群的记录**。

`/api/messages` 的返回里，`transcript` 是喂给模型的文本，`messages` 是同一批消息的结构化投影
（`kind` / `lines` / `mentions` / `media` / `parentId` …），界面画气泡用的是后者——
一份数据两个用途，不会出现"界面显示的"和"模型读到的"不一致。

`/api/media` 只接受形如 `om_…` / `img_…`/`file_…` 的 ID，飞书 URL 由宿主自己拼，
所以它不是"任意 URL 代理"；单次最多转发 20 MB，`type=file` 会把 `Range` 透传给飞书（拖动播放要用）。

读任务失败时面板**不会**说「没有未完成的任务」：这种情况返回空列表会同时带上
`tasksError`，面板显示成一条红色错误（并提示可以点「刷新」重试）。缓存规则是
「成功的结果缓存 60 秒；失败不缓存，只在 15 秒内重复上报，之后自动重试」。

## 界面

配色不写死色值，全部走 DSH 自己的设计令牌（`--dsw-*`：`--dsw-alias-state-business-primary`
做蓝色主色、白底 + 浅蓝 hover、圆角胶囊 chip、蓝色焦点环），所以浅色/深色主题都跟着 DSH 走。
本地再包一层 `--ff-*` 别名，改配色只改一处。图例：

| 元素 | 效果 |
|---|---|
| 左侧边栏底部「飞书」 | 官方彩色 logo（16px）+ 文字；窄栏只显示 logo |
| 「我的任务 / 群聊总结」 | 分段控件：浅灰轨道 + 白色药丸，选中项蓝字加粗 |
| 任务行 | hover 浅蓝底；逾期 chip 琥珀色、高优先级红色 |
| 「完成」 | 蓝色「同步中…」+ 转圈 → 白色对勾、绿色填充；整行变绿并向左收起 |
| 完成提示 | 面板底部弹出白色卡片 + 绿色圆形对勾（4 秒后自动消失，可手动关） |
| 失败 | 红色错误条 + 红色 toast，绝不再显示成「没有未完成的任务」 |
| 聊天记录 | 头像 + 昵称 + 时间的气泡流；同一人 5 分钟内的连续消息合成一组（跨零点不合并） |
| 气泡 | 别人靠左浅灰底、自己靠右浅蓝底；`@某人` 高亮、URL 变链接、`> ` 引用块、撤回居中系统行 |
| 日期分隔 | 「今天 / 昨天 / 2026-09-09 周三」，打开群自动停在最新一条 |
| 图片/文件 | 图片直接显示缩略图（点击开原图），文件/语音/视频显示成卡片，语音视频可播放 |
| 每条消息 | hover 时「加入输入框」出现在气泡**外侧**（浮在行边缘，不占垂直空间），插入的是 `> [HH:mm]张三: 内容` 这样的引用行 |
| 行距 | 刻意压紧：连续两条气泡只隔 4px，独立一行（带昵称）53px 高 —— 聊天列是读「节奏」的，行内每一像素都是从对话里抢来的 |
| 昵称读不到时 | 不编造身份：顶部黄条数出有几条无法归属，气泡昵称显示「未知成员」、头像变灰色虚线圈 —— 短 ID 只在 hover 的 `title` 里出现，也只在给模型的 prompt 里当发言人代号；整段记录不会因为昵称失败而丢掉 |

logo 用的是官方彩色标志（透明 PNG，48×48，1.3 KB）内联成 data URI 写在 bundle 里：
渲染时不联网、不引依赖，也不自己临摹——标志本身在视觉上就是品牌资产，画歪比画丑更糟。
色值取自图本身：`#3370ff` 蓝、`#00d6b9` 青、`#133c9a` 深蓝。右侧边栏「+」菜单里的
那个入口胶囊也用同一个标志。

配色回归由用例兜底：`node test/run.mjs` 里有一条会把样式表里所有 `--dsw-*` 令牌
和本机 DSH 的主题定义对照，写错一个名字（规则会静默失效）就会失败。

想在没碰过真飞书租户的情况下看这套界面，可以用自带的假飞书 API：

```powershell
node scripts/stub-feishu.mjs 3098          # 假任务/群/消息
# 把隔离 home 的 settings.yaml 的 baseUrl 指向它，再起 dsh --port 3099

$env:STUB_NO_MEMBERS=1; node scripts/stub-feishu.mjs 3098   # 群成员接口按 232011 失败 → 「未知成员」那条路
```

## 目录结构

宿主半按职责拆开，每个文件都在 500 行以内：

```
lib/index.js             插件入口：装配 client / 缓存 / 读取 / 路由 / 模型工具，别的都不做
lib/plugin/support.mjs   Cordis 身份、设置 schema、读缓存决策、HTTP 与解析小工具
lib/plugin/reads.mjs     带缓存的三类读取：任务、群列表、群成员名字、群聊记录
lib/plugin/routes.mjs    /plugin/feishu 下的全部路由
lib/plugin/tools.mjs     两个模型工具（feishu_tasks / feishu_summarize）
lib/feishu.mjs           飞书模块的门面（re-export，供插件层与测试统一 import）
lib/feishu/common.mjs    域名、权限、错误类型与错误提示表
lib/feishu/transport.mjs 两种凭证的缓存与请求助手（凭证回退策略在这里）
lib/feishu/content.mjs   纯投影：任务 / 群 / 消息 → 界面与提示词要的形状
lib/feishu/api.mjs       一个接口一个函数（任务、群、成员、消息、资源、用户信息）
lib/summary.mjs          DeepSeek 总结提示词、流式收集、容错 JSON 解析
lib/client.js            浏览器半：手写的 DSH 懒加载 CJS bundle（Tab + 面板 UI + 设置卡片）
test/                    121 个用例（自研 in-process 轻量 harness，零依赖）
scripts/                 bootstrap-deps / apply-profile / apply-settings / check / panel-check / cdp / stub-feishu
docs/                    安装说明
.feishu-docs/            从飞书官方文档下载的接口说明（Markdown）
```

测试同样按主题拆开，`*-harness.mjs` 是被复用的替身（不是测试模块，`run.mjs` 只认 `*.test.mjs`）：

```
test/panel-harness.mjs  panel-entry.test.mjs  panel.test.mjs  panel-chat.test.mjs
test/routes-harness.mjs routes.test.mjs       routes-chat.test.mjs
test/feishu-client-harness.mjs  feishu-client.test.mjs  feishu-client-chat.test.mjs
test/bundle.test.mjs  feishu-content.test.mjs  summary.test.mjs  settings.test.mjs  settings-card.test.mjs
```

> **`lib/client.js` 是唯一的例外，而且拆不开。** DSH 的客户端插件契约是
> `exports["./client"]` **一个产物**：宿主侧 `clientPath = join(dirname(pkgPath), clientRel)`
> 是单路径，boot graph 每个插件也只有一行 URL；bundle 里的 `require` 只认 9 个平台 seed
> 和其它插件的 id，**不认同包的兄弟文件**。要把它拆成多个源文件，就必须引入一个
> 「把 `lib/client/*.js` 拼成 `lib/client.js`」的构建步骤，而本仓库的设计之一正是
> **没有构建步骤**（见下节）。所以这个文件保持单文件，并按主题分成明显的区段
> （样式 / 文案 / 纯函数 / 组件 / 面板 / 设置卡片）。

## 构建说明（为什么没有构建步骤）

npx 安装里没有 typescript / esbuild / tsdown，而 DSH 的客户端插件 bundle 约定是
一个**懒加载 CJS 工厂**：

```js
window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => { ...; exports.apply = apply; exports.inject = inject; return module.exports } })
```

`factory` 里只能 `require` 平台 seed 表里的 9 个模块（`react`、`react/jsx-runtime`、
`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`dsh-client-store`、
`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`）。
本插件只用到 `react`，因此 `lib/client.js` 直接手写成这个格式：没有打包步骤，
改完刷新页面即可（本机没跑 `pnpm run dev:web`，客户端 HMR 不会自动生效；
宿主半代码改动需要重启 `dsh web`）。

宿主半是普通 ESM，只用两个裸依赖（`@deepseek-ai/schemastery` 做设置 schema、
`@deepseek-ai/dsh-tools` 注册模型工具），由 `scripts/bootstrap-deps.mjs` 链接到
DSH 安装里的同一份包。

手写 bundle 有一个反复踩到的坑，写在这里免得再踩：组件不要只读
`props.children`。`h(Note, props, '一行文字')` 这种**单个字符串孩子**在 React 里会变成
`props.children`，但在本仓库的测试替身里只会进 `node.children`——两边因此长得不一样，
线上空白的提示条在用例里是绿的。约定是读 `props.children` 并 `...(Array.isArray(...) ? … : [ … ])`
展开传给 `h`，两种渲染路径都成立（`test/panel-chat.test.mjs` 有一条断言守着它）。

开发时想让聊天视图走到「昵称解析不出来」的那条路，用
`STUB_NO_MEMBERS=1 node scripts/stub-feishu.mjs 3210`：替身会把群成员接口按 `232011`
（操作者不在群里）返回，面板就会显示「未知成员」+ 灰色虚线圈 + 顶部说明条。

## 已知限制

- **授权需要一次手工复制粘贴**：飞书应用只有一份重定向 URL 白名单，且不接受本地地址，
  所以回调必须落在你自己的域名上，再由你把 URL 粘回面板（见上文）。
- **`panel-check --ui` 在本机跑不通**：脚本自带的那个 Chromium 用 `--single-process` 渲染完整 SPA 会崩
  （`node scripts/panel-check.mjs` 的非 UI 部分照常验证：插件进入 boot graph、bundle 下发、HTTP 接口可用）。
  UI 链路是用共享浏览器在真实 GUI 上人工核对 + `test/panel.test.mjs` 的渲染用例覆盖的。
- **头像多数是首字母圆圈**：消息行只带 `open_id`，飞书不返回昵称/头像。昵称靠群成员接口补上（不需要新权限），
  但**别人的头像**要通讯录权限（`contact:user.base:readonly`），那意味着重新授权一次——所以目前只有
  自己（换 token 时顺手拿到）和群头像会尝试真实图片，其余用按 ID 稳定取色的首字母圆圈。
  **名字解析不出来时不取色、不取名**：灰色虚线圈 +「未知成员」，因为给一个 ID 哈希配一种颜色、
  再把 ID 截断当昵称，和直接编一个人名给人的感觉是一样的。
- **模型工具是否对会话可见取决于组合**：Web 面把工具移到 agent preset 平面，
  宿主平面注册不一定生效。`toolsEnabled: false` 可以关掉。
- **没有持久缓存**：任务与群列表是内存缓存（60/120 秒），重启后重新拉取；群成员名字缓存 10 分钟。
- **不支持话题（thread）消息**：只按 `container_id_type=chat` 拉取主会话，`thread_id` 只透传不建树。
- **消息列表最多渲染最近 300 条**：后端上限还是 2000 条，超出部分前端显示「只显示最近 N 条」，
  不做虚拟滚动。
- **空输入框不改配置**：因此无法通过清空字段来"恢复默认值"，需要直接编辑 `settings.yaml`。

## 许可证

MIT。
