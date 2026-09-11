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

# Self-check before installing.
node scripts/check.mjs

# Write into DSH's web profile; the current configuration is backed up first.
node scripts/apply-profile.mjs
```

Then restart `dsh web` and refresh the browser. The first install always requires the restart. Later changes to `lib/index.js` require it too; changes to `lib/client.js` only need a page refresh.

To preview without modifying anything:

```powershell
node scripts/apply-profile.mjs --dry-run
```

Installation details, isolated verification, and custom DSH paths are covered in [docs/install.md](docs/install.md).

### 2. Create and configure the Feishu app

Create an "enterprise self-built app" in the [Feishu developer console](https://open.feishu.cn/app) and do the following:

1. Add and publish the **Bot** capability.
2. Request and publish the permissions listed below under "Permissions".
3. Publish the app and add yourself to its availability scope.

| Permission | Purpose | Required |
| --- | --- | --- |
| `im:chat:readonly` | List the chats the bot is in | Yes |
| `im:message:readonly` | Read messages | Yes |
| `im:message.group_msg` | Read all messages in a group | Yes, for chat summaries |
| `task:tasklist:read` | Read task lists | Yes, for the task list |
| `task:task:read` | Read tasks assigned to you | Yes, after signing in |
| `task:task:write` | Complete or reopen a task | Yes, when using the Complete button |
| `offline_access` | Obtain a refresh token to stay signed in | Recommended |

If you add a permission later, **re-authorize** in the plugin: an existing token does not gain the new permission automatically.

### 3. Enter the App ID and App Secret

After the restart, open in DSH: **Settings → Plugins → Plugin configuration → feishu-plugin**, enter the Feishu app's App ID and App Secret, and save.

The same thing from the command line:

```powershell
node scripts/apply-settings.mjs --app-id cli_xxx --app-secret your_secret
node scripts/apply-settings.mjs --show
```

The configuration is written to the `feishu-plugin` section of `$DSH_HOME/settings.yaml` and hot-reloaded, so no further restart is needed. The secret is never echoed back by a read endpoint or the settings form.

## Using it inside DSH

Click "飞书" at the bottom of the left sidebar:

| Where | What you can do |
| --- | --- |
| Inside a session | Open the "飞书" panel on the right; "add to input" appends to the current conversation draft. |
| Home screen | Open the full Feishu page; tasks and chats are available, but there is no session input to insert into. |

Inside the panel:

1. **My tasks**: the task list is shown first; to see tasks assigned to you or to complete a task, click "Sign in to Feishu" and authorize once.
2. **Chat summaries**: pick a chat the bot is in, read the messages first, or generate an AI summary and action items.
3. When the model should take something further, click "add to input" next to any task, message, or action item, then review it yourself before sending.

What "add to input" inserts is deliberately short. A task becomes **one line**, `- [ ] task title（due …）[list: …]`, and a message becomes a quote line, `> [HH:mm]Name: text`. A task's **description is not inserted**: tasks created by an agent tend to pack the meeting, the priority, a 妙记 token, and a source uuid into the description, and pasting all of that buries the one sentence you meant to act on. The description still lives in Feishu itself, and the panel row does not show it either.

## Why you sometimes need to sign in to Feishu

With only the App ID / App Secret configured, the plugin already reads task lists and the bot's chats as the bot. These operations require your `user_access_token`:

- reading tasks assigned to you;
- completing or reopening a task.

One authorization is usually enough. When the token expires, the plugin tries to refresh it automatically.

### The copy-paste way to handle the authorization callback

Feishu requires the OAuth redirect address to be on the app's allowlist in advance, and often refuses a local `127.0.0.1` address. If your app's callback is an existing public address, do this:

1. Put that allowlisted address into the plugin's `oauthRedirectUri`.
2. Click "Open authorization page" and authorize in Feishu.
3. After the browser lands on the callback address, copy the **complete URL from the address bar** into the plugin's authorization area and click "Exchange the callback URL".

An error on the callback page itself does not matter for this step: as long as the URL still carries a `code`, it can be exchanged. The authorization code is short-lived and single-use, so paste it promptly.

## Common configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `appId` / `appSecret` | empty | Feishu app credentials, required |
| `baseUrl` | `https://open.feishu.cn` | Lark international uses `https://open.larksuite.com` |
| `oauthRedirectUri` | empty | Must match the Feishu console's allowlist exactly |
| `maxMessages` | `200` | Messages read per summary, 10–2000 |
| `summaryProvider` / `summaryModel` | empty | Empty uses DSH's current default model |
| `toolsEnabled` | `true` | Whether to provide the two model tools |

Changing a single key from the command line:

```powershell
node scripts/apply-settings.mjs --set "maxMessages=300"
node scripts/apply-settings.mjs --set "baseUrl=https://open.larksuite.com"
```

**Note: leaving a field blank in the settings form or on the command line means "do not change", not "clear".** To remove a stored value, edit `$DSH_HOME/settings.yaml` directly.

## FAQ

### No chats or messages show up

Confirm the Bot capability has been published, the bot has been added to the target group, and `im:chat:readonly`, `im:message:readonly`, and `im:message.group_msg` are granted. Group history only reads chats the bot is in.

### There are no "assigned to me" tasks in the task area

Click "Sign in to Feishu" first to authorize, and confirm `task:task:read` is published. While signed out, the plugin falls back to task lists, which is intended behaviour.

### Clicking "Complete" fails

That operation writes to Feishu, so it needs a signed-in user with `task:task:write`. When the permission was added later, re-authorize.

### The app says the redirect address is invalid

Check that `oauthRedirectUri` and the Feishu console's "Security settings → Redirect URL" match character for character. When a local address cannot be used, switch to a registered public callback and use the copy-paste exchange above.

### Saving the settings had no effect

Use `node scripts/apply-settings.mjs --show` to confirm where and what was written. If the plugin was just installed, restart `dsh web` once first so the plugin's settings section finishes registering.

## Development and verification

```powershell
node scripts/check.mjs              # syntax, dependencies, and tests
node scripts/panel-check.mjs        # verify plugin loading and endpoints in an isolated DSH home
node scripts/panel-check.mjs --ui   # additionally attempt a headless-browser UI check
```

During development you can start a local fake Feishu service, no real tenant required:

```powershell
node scripts/stub-feishu.mjs 3098
# STUB_NO_MEMBERS=1 makes the member endpoint fail, i.e. the "unknown member" path
```

The project's HTTP endpoints live under the same-origin path `/plugin/feishu/api/*`. For the source layout and the full installation wiring, see [docs/install.md](docs/install.md) and the comments under `lib/`.

## Known limitations

- Feishu thread (topic) messages are not supported; only the main group conversation is read.
- The front end renders at most the newest 300 messages; the backend read cap can still be raised to 2000 via `maxMessages`.
- Other members usually show as a stable initial-circle avatar; real avatars need an extra contacts permission.
- Whether the model tools appear in a given session also depends on that DSH composition's agent presets.

## License

MIT
