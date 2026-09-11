# dsh-feishu-plugin

[中文](README.md) · [English](README.en.md)

Bring Feishu tasks and chats where your bot is a member into [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web. Read tasks and messages, summarize conversations with a model, and add follow-up context to the current chat draft in one click.

> This is a third-party DSH plugin. You need a working `dsh web` installation and Node.js 20 or later.

If your terminal cannot find `dsh`, that is expected: it is not a command provided by this repository. It is the CLI from the separate `@deepseek-ai/dsh` package. You can use it without a global install:

```powershell
npx @deepseek-ai/dsh plugin --profile web add D:\desktop\repos\dsh-feishu-plugin
```

Install it globally only if you use DSH often:

```powershell
npm install -g @deepseek-ai/dsh
dsh plugin --profile web add D:\desktop\repos\dsh-feishu-plugin
```

The argument order is `dsh plugin --profile web add <path>`, not `dsh plugin add --profile web <path>`. The repository-local `apply-profile.mjs` described below is an equivalent installation method and is useful when developing or validating a clone of this repository.

## What it does

- **My tasks**: view Feishu tasks; after user authorization, view tasks assigned to you.
- **Chat summaries**: read chats where the bot is a member, render their messages in a chat-like view, and generate a summary, key points, and action items.
- **Continue with the model**: add a task, message, or action item to the current input. It appends to the draft and **never sends automatically**.
- **Complete a task**: the Complete button updates the task in Feishu; it is not a local hide action.
- **Model tools**: `feishu_tasks` and `feishu_summarize` are available to DSH conversations by default.

## Get started in five minutes

### 1. Install into DSH

From the repository root, run:

```powershell
# Link the DSH runtime dependencies. Safe to re-run.
node scripts/bootstrap-deps.mjs

# Validate the installation before applying it.
node scripts/check.mjs

# Add the plugin to the DSH web profile. The original file is backed up first.
node scripts/apply-profile.mjs
```

Restart `dsh web`, then refresh the browser. A restart is required on first installation and after changes to `lib/index.js`; changes to `lib/client.js` only require a browser refresh.

To preview the profile change without writing it:

```powershell
node scripts/apply-profile.mjs --dry-run
```

See [docs/install.md](docs/install.md) for detailed installation, isolated validation, and a custom DSH path.

### 2. Create and configure a Feishu app

Create an **enterprise custom app** in the [Feishu Developer Console](https://open.feishu.cn/app), then:

1. Add and publish the **Bot** capability.
2. Request and publish the permissions below.
3. Publish the app and add yourself to its availability scope.

| Permission | Purpose | Required |
| --- | --- | --- |
| `im:chat:readonly` | List chats the bot belongs to | Yes |
| `im:message:readonly` | Read messages | Yes |
| `im:message.group_msg` | Read all group messages | Yes, for chat summaries |
| `task:tasklist:read` | Read task lists | Yes, for the task list |
| `task:task:read` | Read tasks assigned to you | Yes, after sign-in |
| `task:task:write` | Complete or restore tasks | Yes, for the Complete button |
| `offline_access` | Receive a refresh token and stay signed in | Recommended |

If you add permissions later, authorize the plugin again. Existing tokens do not automatically gain new permissions.

### 3. Set the App ID and App Secret

After restarting, open **Settings → Plugins → Plugin configuration → feishu-plugin** in DSH. Enter the Feishu App ID and App Secret, then save.

You can also configure them from the command line:

```powershell
node scripts/apply-settings.mjs --app-id cli_xxx --app-secret your_secret
node scripts/apply-settings.mjs --show
```

The settings are written to the `feishu-plugin` section of `$DSH_HOME/settings.yaml` and hot-reload without another restart. Secrets are never returned by the read APIs or repopulated in the settings form.

## Using it in DSH

Click **Feishu** at the bottom of the left sidebar:

| Where | What you can do |
| --- | --- |
| In a conversation | Open the Feishu panel in the right sidebar. Add to input appends context to the current conversation draft. |
| On the home page | Open the full Feishu page. Tasks and chats are available, but there is no active conversation input to populate. |

In the panel:

1. **My tasks**: view task lists immediately. To see tasks assigned to you or complete a task, select **Sign in to Feishu** once.
2. **Chat summaries**: select a chat where the bot is a member, read its messages, or generate an AI summary and action items.
3. To continue with a model, select **Add to input** on a task, message, or action item; review the draft and send it yourself.

## Why Feishu sign-in is sometimes required

With only an App ID and App Secret, the plugin can read task lists and chats where the bot is a member. The following actions require your `user_access_token`:

- Read tasks assigned to you.
- Complete or restore a task.

Authorization is normally needed only once. The plugin attempts to refresh an expired token automatically.

### Copy-and-paste OAuth callback flow

Feishu requires an OAuth redirect URI to be on the app allowlist and may reject a local `127.0.0.1` address. If your app uses an existing public callback URL:

1. Set that allowlisted URL as `oauthRedirectUri` in the plugin settings.
2. Select **Open authorization page** and authorize the app in Feishu.
3. After the browser reaches the callback address, copy the **entire URL** from the address bar into the plugin authorization area and select **Exchange callback URL**.

An error on the callback page itself does not prevent this flow: the code can still be exchanged while it remains in the URL. Authorization codes are short-lived and single-use, so paste it right away.

## Common configuration

| Setting | Default | Description |
| --- | --- | --- |
| `appId` / `appSecret` | Empty | Feishu app credentials; required |
| `baseUrl` | `https://open.feishu.cn` | Use `https://open.larksuite.com` for Lark International |
| `oauthRedirectUri` | Empty | Must exactly match the Feishu allowlisted redirect URI |
| `maxMessages` | `200` | Messages to read for each summary; range: 10–2000 |
| `summaryProvider` / `summaryModel` | Empty | Uses DSH's current default model when empty |
| `toolsEnabled` | `true` | Enables or disables the two model tools |

To change one setting from the command line:

```powershell
node scripts/apply-settings.mjs --set "maxMessages=300"
node scripts/apply-settings.mjs --set "baseUrl=https://open.larksuite.com"
```

**Important: an empty settings field or command argument means “leave unchanged,” not “clear this setting.”** To remove an existing value, edit `$DSH_HOME/settings.yaml` directly.

## Troubleshooting

### No chats or messages appear

Confirm that the bot capability is published, the bot has joined the target chat, and the app has `im:chat:readonly`, `im:message:readonly`, and `im:message.group_msg`. Chat history is only available for chats the bot belongs to.

### No tasks assigned to me

Select **Sign in to Feishu** to finish user authorization and confirm that `task:task:read` has been published. Without sign-in, the plugin falls back to task lists; this is expected.

### Completing a task fails

This operation writes to Feishu, so it requires user sign-in and `task:task:write`. If that permission was added later, authorize again.

### The redirect URI is rejected

Check that `oauthRedirectUri` exactly matches **Security settings → Redirect URL** in the Feishu Developer Console. If a local address is not accepted, use an allowlisted public callback URL and the copy-and-paste exchange flow above.

### A saved setting does not take effect

Run `node scripts/apply-settings.mjs --show` to confirm the location and value. If you just installed the plugin, restart `dsh web` once so its settings section can register.

## Development and validation

```powershell
node scripts/check.mjs              # Syntax, dependencies, and tests
node scripts/panel-check.mjs        # Validate loading and APIs in an isolated DSH home
node scripts/panel-check.mjs --ui   # Additionally attempt headless-browser UI validation
```

For local development without a real Feishu tenant, start the bundled fake Feishu service:

```powershell
node scripts/stub-feishu.mjs 3098
```

The same-origin HTTP API lives under `/plugin/feishu/api/*`. See [docs/install.md](docs/install.md) and comments in `lib/` for source responsibilities and full installation wiring.

## Known limitations

- Feishu topic (thread) messages are not yet supported; only the main chat is read.
- The UI renders at most the latest 300 messages; the backend read limit can still be raised to 2000 with `maxMessages`.
- Other members usually have stable initial avatars; real avatars require additional directory permissions.
- Whether model tools appear in a particular conversation also depends on that DSH composition's Agent preset configuration.

## License

MIT
