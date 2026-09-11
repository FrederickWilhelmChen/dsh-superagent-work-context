# 安装与接线

这份文档只讲「怎么把它装进正在跑的 DSH」，功能说明见仓库根目录
[README.md](../README.md)。

## 前提

- 已有一个能正常启动的 `dsh web`（本文以默认的 `web` profile、端口 3080 为例）。
- Node ≥ 20（本机 v24）。
- 本仓库路径：`D:\desktop\repos\dsh-feishu-plugin`。

## 1. 链接运行时依赖

宿主半按名字导入两个包，它们必须能从本仓库解析到 DSH 安装里的同一份实例：

```powershell
node scripts/bootstrap-deps.mjs
```

脚本会在 `node_modules/@deepseek-ai/` 下建立目录联接（junction）指向 npx 安装，
幂等、可重复执行；找不到安装时可以显式指定：

```powershell
node scripts/bootstrap-deps.mjs "C:\Users\me\AppData\Local\npm-cache\_npx\<hash>\node_modules"
```

## 2. 自检

```powershell
node scripts/check.mjs
```

依次做：`node --check` 四个源文件 → 检查依赖链接 → 跑 53 个用例
（消息投影、总结解析、飞书客户端分页/凭证/错误归一化、bundle 静态校验、
面板渲染与「加入输入框」链路）。全部通过会打印 `check passed`。

## 3. 装进 profile

```powershell
# 预览将要写入的内容，不落盘
node scripts/apply-profile.mjs --dry-run

# 真的写（会先备份 cordis.patch.yml → cordis.patch.yml.bak）
node scripts/apply-profile.mjs
```

它会往 `$DSH_HOME\profiles\web\cordis.patch.yml` 里加一行
（`name` 必须是**入口文件**，Node 不接受目录导入）：

```yaml
- insert:
    - id: feishu-plugin
      name: "file:///D:/desktop/repos/dsh-feishu-plugin/lib/index.js"
```

想同时写入初值可以加 `--config`：

```powershell
node scripts/apply-profile.mjs --config "appId=cli_xxx,baseUrl=https://open.larksuite.com"
```

其它参数：`--profile <名字>`（默认 `web`）、`--home <DSH_HOME>`、`--force`
（覆盖已存在的同名行）。脚本只重写文件里第一个 `- insert:` 之后的部分，
文件顶部的注释和别的覆盖行都保持原样。

## 4. 重启并刷新

新插件首次装载必须**重启**
`dsh web`（`client-modules` 只在启动时扫描 `dsh.client` 声明）；重启后刷新页面。

> 之后改 `lib/client.js` 需要刷新页面；本机没有跑 `pnpm run dev:web`，
> 客户端 HMR 不会自动生效。改 `lib/index.js` 需要再重启一次。

## 5. 填凭证

打开 **设置 → 插件 → 插件配置**，里面有 **feishu-plugin** 卡片，填 App ID / App Secret 后点保存。

命令行等价：

```powershell
node scripts/apply-settings.mjs --app-id cli_xxx --app-secret yyy
```

它写进 `$DSH_HOME\settings.yaml` 的 `feishu-plugin:` 段（只动这一段，别的命名空间原样保留）。
settings provider 是**热加载**的，所以运行中的 `dsh web` 立刻生效，不用重启；
`appSecret` 在 schema 里是 `role('secret')`，读接口不会回显。

查看现值：

```powershell
node scripts/apply-settings.mjs --show
```

> **那张卡片是本插件自己注册的。** 设置页没有「按 schema 自动生成表单」这一层：
> `settings.plugin.item` 是 keyed 插槽，页面只为注册了卡片的命名空间画表单。
> 本插件的浏览器半用 `ctx.settingsScope.bind({ namespace: 'feishu-plugin' })` 绑定
> 自己的命名空间，并以同一个 key 注册卡片。

填完回到右侧边栏的「飞书」Tab（或点会话标题栏的「飞书任务」按钮）。

## 6. 飞书开发者后台

见 [README 的对应章节](../README.md#飞书开发者后台怎么配)。要点：

- 开启**机器人能力**并发布；
- 开通 `im:chat:readonly`、`im:message:readonly`、`im:message.group_msg`、
  `task:task:read`、`task:tasklist:read`、`offline_access`；
- 安全设置里把 `http://127.0.0.1:3080/plugin/feishu/api/auth/callback`
  加进重定向 URL（本地 http 可能不被接受，接受不了就走「粘贴回调地址」）。

## 隔离验证（不碰你正在用的 3080）

```powershell
node scripts/panel-check.mjs        # 起 ./dsh-test 隔离 home + 3099 端口，验证装载与接口
node scripts/panel-check.mjs --ui   # 额外用无头 Chromium 点一遍 UI（见下方限制）
node scripts/panel-check.mjs --keep # 保留 .dsh-test 便于事后翻 server.log
```

它会：造一个隔离 `DSH_HOME`（仓库内 `.dsh-test`）→ 用 `apply-profile` 装插件 →
以 `--port 3099` 启动 → 断言 boot graph 里有本插件、bundle 能下发、
`/plugin/feishu/api/state` 正常、未知路由返回 `ok:false`、`/api` 没被抢占。

### `--ui` 在部分机器上不可用

`scripts/cdp.mjs` 直接用 CDP 驱动 Playwright 缓存里的 Chromium（不引第三方依赖）。
在受限沙箱里：

- 多进程 Chromium 起不来（内部 IPC 需要命名管道，被策略拒绝）；
- `--single-process` 能起来，但渲染完整 SPA 时会 abort。

所以 `--ui` 在那种环境下会失败。**这不影响插件本身**：
「加入输入框」这条链路由 `test/panel.test.mjs` 直接跑真实组件代码验证
（追加而非覆盖、空草稿不加换行、没有会话时禁用按钮）。
