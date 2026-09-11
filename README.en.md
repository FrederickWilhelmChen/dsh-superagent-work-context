# dsh-feishu-plugin

[中文](README.md) · [English](README.en.md)

A third-party plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):

- reads your **Feishu (Lark) tasks** into the DSH Web GUI's **right sidebar**;
- lists the **group chats the bot is in** and renders the history **like a chat app**
  (avatars, names, bubbles, day separators, quotes, images), then runs a
  **one-click DeepSeek summary** that extracts action items;
- every task / action item carries an **"Add to input"** button that appends the text to the
  current session composer (it never sends on its own);
- the **"Complete"** button on a task row **really completes the task inside Feishu**
  (a write API, not a local hide);
- registers two model tools, `feishu_tasks` / `feishu_summarize`, so a conversation can ask the
  model to read tasks or summarize a group directly.

The entry point is the **bottom of the left sidebar** (same row as "Settings": the official
Feishu logo plus the word "飞书"). It is **visible on the home screen too** — nothing is added to
the session title bar:

```
left sidebar, bottom entry "飞书"
├─ clicked inside a session → opens the right sidebar's "飞书" tab
│                             (the composer is right there, [Add to input] works)
└─ clicked on the home screen → a full-page view in the centre column
                                (tasks and summaries work; there is no composer to insert into)

right sidebar tab "飞书"
├─ 我的任务 (My tasks) ── task list + [加入输入框] + [完成]
└─ 群聊总结 (Chat summaries) ── pick a chat →(auto-load)→ two sub-views
                ├─ 聊天记录 (Messages) ── avatar + name + time + bubbles + day separators + quotes + image thumbnails
                └─ AI 摘要   (AI summary) ── summary / key points / action items + [加入输入框]
```

> Why not one of the left rail's "panel icons"? Because **a panel icon switches the centre
> column**, and the right sidebar's session pane only exists while a conversation is selected —
> by the time the page has mounted, there is no session left to open a tab beside. The bottom
> row is a seat the plugin handles the click for itself: it can open the tab first and fall back
> to the full-page view only when it has to.

## Quick start

```powershell
# 1) link the runtime packages into this repo (idempotent, safe to re-run)
node scripts/bootstrap-deps.mjs

# 2) self-check: syntax + dependencies + 121 cases
node scripts/check.mjs

# 3) install into the web profile (backs up cordis.patch.yml first)
node scripts/apply-profile.mjs

# 4) restart `dsh web` (required for a first load), then refresh the page
```

After the restart, open **Settings → Plugins → Plugin configuration**: there is a
**feishu-plugin** card. Fill in the App ID / App Secret and save — that writes
`$DSH_HOME/settings.yaml` and is hot-reloaded, no restart needed. `appSecret` carries
`role('secret')` in the schema, so no read endpoint echoes it and the form never refills it.

> **That card is registered by this plugin itself.** DSH's settings page has no
> "generate a form from the schema" layer: `settings.plugin.item` is a keyed slot, and the page
> draws a form only for the namespaces that registered a card. The browser half binds its own
> namespace with `ctx.settingsScope.bind({ namespace: 'feishu-plugin' })` and registers the card
> under the same key — which is exactly the extension point DSH leaves for third-party plugins.
>
> Prefer the command line? The equivalent:
>
> ```powershell
> node scripts/apply-settings.mjs --app-id cli_xxx --app-secret yyy
> ```

Inspect the current configuration at any time (the secret only reports its length):

```powershell
node scripts/apply-settings.mjs --show
```

One hard rule when saving: **an empty input means "leave it alone", never "erase it".** Every
field has a schema default and a stored value can only have come from you typing it, so writing a
blank back would silently destroy the configuration (this once wiped the redirect URI, which made
Feishu answer `20029` / `20063`). To change a value, type a new one.

Then click **the "飞书" entry at the bottom of the left sidebar** (the home screen works too, and
opens the full-page view directly):

- the task area immediately shows the **tasks readable by the app's own credentials**;
- for **"assigned to me"** tasks, click "登录飞书" (Sign in to Feishu) and complete one user
  authorization round (see below).

## Why one user authorization is needed

Different Feishu endpoints accept different credentials — that is a property of the APIs:

| Capability | Endpoint | Credential accepted | Scope |
|---|---|---|---|
| "Assigned to me" tasks | `GET /open-apis/task/v2/tasks?type=my_tasks` | **`user_access_token` only** | `task:task:read` |
| Task lists / tasks in a list | `GET /open-apis/task/v2/tasklists[/{guid}/tasks]` | tenant or user | `task:tasklist:read` |
| Complete / reopen a task | `PATCH /open-apis/task/v2/tasks/{guid}` | user token | **`task:task:write`** |
| Chats the bot is in | `GET /open-apis/im/v1/chats` | `tenant_access_token` (bot capability) | `im:chat:readonly` |
| Chat history | `GET /open-apis/im/v1/messages` | tenant / user, and **the bot must be in the chat** | `im:message:readonly` + `im:message.group_msg` |
| Group member names | `GET /open-apis/im/v1/chats/{chat_id}/members` | **tenant token** (the operator must be in the chat) | `im:chat:readonly` |
| Current user (`open_id` / name / avatar) | `GET /open-apis/authen/v1/user_info` | user token | **none** |
| Images / files inside messages | `GET /open-apis/im/v1/messages/{id}/resources/{key}` | tenant token | `im:message:readonly` |

So: **chat summaries need only the bot token** (configure the credentials and they work);
**"assigned to me" tasks and the "Complete" button need one authorization from you.** While
signed out the plugin falls back to task-list tasks and labels the source on the panel instead of
erroring out.

The names, images and "which message is mine" that the chat view needs all use the scopes
**already listed above**, so upgrading to the chat-style view **requires no re-authorization**.

## Authorization: why there is a copy-paste step

A Feishu app has exactly **one redirect-URL allowlist**. If your app is already bound to some
other callback (say a service of yours at
`https://your-domain/webhooks/feishu/oauth/callback`), then:

1. the authorization page must carry an allowlisted address or Feishu refuses outright (**20029**);
2. after the user consents, Feishu delivers the `code` to **that** address, not to your local DSH;
3. so the local DSH never sees the callback — you have to **paste the URL from the address bar
   back into the panel** and exchange it there.

The panel's "飞书授权" block stays visible for exactly this reason:

1. click **"打开授权页"** and approve in Feishu;
2. the browser lands on the callback (the page **shows an error — ignore it**; the server could
   not exchange the code, but the `code` is still in the URL);
3. copy the **whole URL** from the address bar, paste it into the panel's input and click
   **"用回调地址兑换"**.

The authorization code lives for 5 minutes and can be used once. On success the
`user_access_token` and `refresh_token` are written to `settings.yaml` and refresh themselves
afterwards — this step is never repeated.

If a service of yours (dc-agent, for instance) can reach this DSH on the same machine, it can also
forward the `code` for you (`dc-core` has that implementation; it recognizes this kind of
authorization by the `dsh-feishu-` prefix on the OAuth `state`).

## Configuring the Feishu developer console

1. Create an **enterprise self-built app** in the
   [developer console](https://open.feishu.cn/app).
2. **App capabilities → add "Bot"**, and publish a version (otherwise the chat/message endpoints
   answer `232025`).
3. Under **Permissions**, enable and publish:

   | Scope | Purpose |
   |---|---|
   | `im:chat:readonly` (or `im:chat`) | list the chats the bot is in |
   | `im:message:readonly` | read p2p / group messages |
   | `im:message.group_msg` | read all messages in a group (required for group history) |
   | `task:task:read` | read tasks (the panel list) |
   | `task:task:write` | **write** tasks — the panel's "Complete" button really writes to Feishu |
   | `task:tasklist:read` | read task lists |
   | `offline_access` | makes Feishu return a `refresh_token`; without it the authorization dies after a few hours |

4. **Security settings → Redirect URL**: the address the plugin asks with must be on that
   allowlist. Put your address into the plugin's `oauthRedirectUri` (the "重定向 URL" field on the
   settings card), for example:

   ```
   https://your-domain/webhooks/feishu/oauth/callback
   ```

   ⚠️ Feishu **does not accept** local addresses such as `http://127.0.0.1:...`, so DSH's own
   callback path (`/plugin/feishu/api/auth/callback`) may be rejected even if you allowlist it —
   which is the other reason the copy-paste step exists.

5. **Publish** the app and add yourself to its **availability scope** (otherwise authorization
   answers `20010`).

> Scopes are **baked into the token at authorization time**. Adding a scope in the console
> afterwards requires **re-authorizing in the panel**; the old token does not gain it (it shows up
> as `99991679`, and the plugin says so).

## Configuration reference

Edit it on the **Settings → Plugins → Plugin configuration → feishu-plugin** card, or from the
command line:

```powershell
node scripts/apply-settings.mjs --show                         # current values
node scripts/apply-settings.mjs --set "maxMessages=300"         # change one key
node scripts/apply-settings.mjs --app-id cli_x --app-secret y   # change credentials
```

Both write the same place: the `feishu-plugin:` section of `$DSH_HOME/settings.yaml` (hot-reloaded,
effective immediately). A profile's `cordis.patch.yml` can also seed values under `config:` — that
layer ranks below user settings.

| Key | Default | Meaning |
|---|---|---|
| `appId` / `appSecret` | empty | Feishu self-built app credentials (required) |
| `baseUrl` | `https://open.feishu.cn` | Open-platform origin; Lark international uses `https://open.larksuite.com` |
| `oauthTokenUrl` | `https://accounts.feishu.cn/oauth/v3/token` | OAuth token endpoint |
| `oauthRedirectUri` | empty | **Must** be an allowlisted address; sent on both the authorize and exchange calls |
| `oauthStatePrefix` | `dsh-feishu-` | OAuth `state` prefix, so a shared callback can route it |
| `maxMessages` | `200` | Messages read per summary (10–2000) |
| `summaryProvider` / `summaryModel` | empty | Empty uses the DSH default model (currently `deepseek-official` / `deepseek-flash`) |
| `toolsEnabled` | `true` | Whether to register the `feishu_tasks` / `feishu_summarize` model tools |
| `userToken` / `refreshToken` / `userTokenExpiresAt` / `userName` | — | Authorization state, maintained by the plugin |

## Host HTTP endpoints

The browser half calls only these same-origin endpoints (prefix `/plugin/feishu`, all returning
`{ok:true,data}` or `{ok:false,error:{message,hint,code}}`):

| Method and path | Purpose |
|---|---|
| `GET /api/state` | Everything the panel needs (config / login / tasks / chats / model) |
| `POST /api/tasks/refresh` | Force a task refresh (bypasses the 60-second cache) |
| `POST /api/tasks/complete` | Complete / reopen a task (**writes to Feishu**) |
| `POST /api/chats/refresh` | Force a refresh of the bot's chat list |
| `POST /api/messages` | Read a chat's recent history (`chatId` / `hours` / `limit`); returns the **UI-shaped message array** plus the model-facing text |
| `POST /api/summarize` | Read + DeepSeek summary, returning `{summary,keyPoints,actionItems}` |
| `GET /api/media` | Relay image / file bytes from a message (`messageId` + `fileKey` + `type`) so `<img>` can use them directly |
| `POST /api/auth/url` | Build the Feishu authorization URL |
| `POST /api/auth/complete` | Exchange an authorization code or callback URL for tokens |
| `POST /api/auth/logout` | Clear the local authorization state |
| `GET /api/auth/callback` | OAuth callback (when the redirect URL is usable) |

The "Refresh" button follows the active tab: on the task tab it refreshes tasks; on the chat tab it
refreshes **both the chat list and the current chat's history**.

In `/api/messages`, `transcript` is the text handed to the model and `messages` is the structured
projection of the same rows (`kind` / `lines` / `mentions` / `media` / `parentId` …) that the UI
draws bubbles from — one dataset, two uses, so "what you see" and "what the model reads" cannot
drift apart.

`/api/media` accepts only `om_…` / `img_…` / `file_…` shaped ids and builds the Feishu URL itself,
so it is not an open URL proxy. A single relay is capped at 20 MB, and `type=file` passes `Range`
through to Feishu (scrubbing needs it).

When a task read fails the panel does **not** claim "no outstanding tasks": that case returns an
empty list together with `tasksError`, which the panel renders as a red error (and suggests
pressing Refresh). The cache rule is: **a successful read is cached for 60 seconds; a failure is
not cached, is re-reported for 15 seconds, and is then retried by itself.**

## The UI

Colours are not hard-coded; everything goes through DSH's own design tokens (`--dsw-*`:
`--dsw-alias-state-business-primary` for the blue accent, white surface with a pale blue hover,
pill chips, a blue focus ring), so light and dark themes follow DSH. A local `--ff-*` alias layer
sits on top, so changing the palette means changing one place. Cheat sheet:

| Element | Behaviour |
|---|---|
| Bottom of the left sidebar | Official colour logo (16 px) + the word "飞书"; a narrow rail shows the logo alone |
| "我的任务 / 群聊总结" | Segmented control: grey track + white pill, the selected label in bold blue |
| Task row | Pale blue on hover; an overdue chip in amber, high priority in red |
| "完成" | Blue "syncing…" with a spinner → white tick on a green fill; the row turns green and collapses left |
| Completion toast | A white card with a green circular tick at the bottom of the panel (auto-dismisses after 4 s, dismissible) |
| Failure | A red error note plus a red toast; never again "no outstanding tasks" |
| Chat history | Bubble stream with avatar + name + time; one speaker's messages within 5 minutes group together (never across midnight) |
| Bubbles | Others left-aligned on pale grey, yours right-aligned on pale blue; `@someone` highlighted, URLs linked, `> ` quote blocks, recalled messages as a centred system line |
| Day separators | "Today / Yesterday / 2026-09-09 Wed"; opening a chat lands on the newest message |
| Images / files | Images render as thumbnails (click for the original); files, voice and video become cards, voice/video are playable |
| Per message | On hover, "Add to input" appears **beside** the bubble (floating at the row edge, costing no vertical space); it inserts a quote line like `> [HH:mm]张三: the text` |
| Spacing | Deliberately tight: consecutive bubbles sit 4 px apart and a full row (with a name) is 53 px tall — a chat column is read for rhythm, and every pixel is taken back from the conversation |
| When names are unavailable | No invented identity: a yellow note counts the unattributable rows, bubbles say "未知成员" (unknown member) and avatars become grey dashed circles — the short id appears only in the hover `title` and in the prompt as a speaker handle; the history is never lost because a name lookup failed |

The logo is the official colour mark (transparent PNG, 48×48, 1.3 KB) inlined as a data URI into
the bundle: nothing is fetched at render time, no dependency is added, and nothing is redrawn by
hand — the mark is a brand asset, and a crooked copy is worse than an ugly one. The colours are
taken from the image itself: `#3370ff` blue, `#00d6b9` teal, `#133c9a` deep blue. The entry pill in
the right sidebar's "+" menu uses the same mark.

The palette is guarded by a test: a case in `node test/run.mjs` compares every `--dsw-*` token in
the stylesheet with this machine's DSH theme definition, so a misspelled token (whose rule would
silently stop applying) fails the suite.

To look at the whole UI without touching a real Feishu tenant, use the bundled fake Feishu API:

```powershell
node scripts/stub-feishu.mjs 3098          # fake tasks / chats / messages
# point the isolated home's settings.yaml `baseUrl` at it, then run `dsh --port 3099`

$env:STUB_NO_MEMBERS=1; node scripts/stub-feishu.mjs 3098   # member endpoint fails with 232011 → the "unknown member" path
```

## Repository layout

The host half is split by responsibility; every file stays under 500 lines:

```
lib/index.js             plugin entry: wires client / cache / reads / routes / tools, nothing else
lib/plugin/support.mjs   Cordis identity, settings schema, the read-cache decision, HTTP + parse helpers
lib/plugin/reads.mjs     the three cached reads: tasks, chat list, member names, chat history
lib/plugin/routes.mjs    every route under /plugin/feishu
lib/plugin/tools.mjs     the two model tools (feishu_tasks / feishu_summarize)
lib/feishu.mjs           the Feishu module facade (re-exports, so plugin code and tests import one place)
lib/feishu/common.mjs    origins, scopes, error type and the error-hint table
lib/feishu/transport.mjs credential caching and request helpers (the credential fallback rule lives here)
lib/feishu/content.mjs   pure projection: tasks / chats / messages → the shapes the UI and the prompt need
lib/feishu/api.mjs       one function per endpoint (tasks, chats, members, messages, resources, user info)
lib/summary.mjs          the DeepSeek summary prompt, stream collection, tolerant JSON parsing
lib/client.js            browser half: the hand-written DSH lazy-CJS bundle (tab + panel UI + settings card)
test/                    121 cases (a small in-process harness, zero dependencies)
scripts/                 bootstrap-deps / apply-profile / apply-settings / check / panel-check / cdp / stub-feishu
docs/                    installation notes
.feishu-docs/            API notes downloaded from Feishu's official documentation (Markdown)
```

Tests are split the same way; `*-harness.mjs` files are shared stand-ins (not suites — `run.mjs`
only picks up `*.test.mjs`):

```
test/panel-harness.mjs  panel-entry.test.mjs  panel.test.mjs  panel-chat.test.mjs
test/routes-harness.mjs routes.test.mjs       routes-chat.test.mjs
test/feishu-client-harness.mjs  feishu-client.test.mjs  feishu-client-chat.test.mjs
test/bundle.test.mjs  feishu-content.test.mjs  summary.test.mjs  settings.test.mjs  settings-card.test.mjs
```

> **`lib/client.js` is the one exception, and it cannot be split.** DSH's client plugin contract
> is **one artifact** for `exports["./client"]`: host-side
> `clientPath = join(dirname(pkgPath), clientRel)` is a single path, the boot graph carries exactly
> one URL per plugin, and a bundle's `require` resolves only the nine platform seeds and other
> plugins' ids — **never a sibling file of the same package**. Splitting it into several sources
> would require a "concatenate `lib/client/*.js` into `lib/client.js`" build step, and having **no
> build step** is one of this repository's design decisions (next section). So the file stays
> single, divided into obvious regions (styles / copy / pure helpers / components / panel /
> settings card).

## Build notes (why there is no build step)

The npx installation ships no typescript / esbuild / tsdown, and DSH's client plugin bundle
convention is a **lazy CJS factory**:

```js
window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => { ...; exports.apply = apply; exports.inject = inject; return module.exports } })
```

Inside `factory` only the nine platform seeds may be required (`react`, `react/jsx-runtime`,
`react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `dsh-client-store`,
`dsh-client-ui-slots`, `dsh-client-ui-primitives`, `dsh-client-ui-dockkit`). This plugin needs only
`react`, so `lib/client.js` is written directly in that format: no bundling step, and a change
takes effect on page refresh (client HMR is not running here unless you run
`pnpm run dev:web`; host-half changes need a `dsh web` restart).

The host half is plain ESM with two bare dependencies (`@deepseek-ai/schemastery` for the settings
schema, `@deepseek-ai/dsh-tools` to register the model tools), linked to the same package copies
inside the DSH installation by `scripts/bootstrap-deps.mjs`.

One trap worth writing down, because it was hit more than once: a component must not read only
`props.children`. A **single string child** such as `h(Note, props, 'one line')` becomes
`props.children` in React, but only ever lands in `node.children` under this repository's test
stand-in — the two render paths then disagree, and a note that is blank in production stays green
in the suite. The convention is to read `props.children` and spread it
(`...(Array.isArray(children) ? children : [children])`), which holds on both paths
(`test/panel-chat.test.mjs` has an assertion guarding it).

To drive the chat view down the "names could not be resolved" path in development, use
`STUB_NO_MEMBERS=1 node scripts/stub-feishu.mjs 3210`: the stub answers the member endpoint with
`232011` (operator not in the chat) and the panel shows "未知成员" plus grey dashed circles and a
note at the top.

## Known limitations

- **Authorization needs one manual copy-paste**: a Feishu app has a single redirect-URL allowlist
  and refuses local addresses, so the callback has to land on a domain of yours and you paste the
  URL back into the panel (see above).
- **`panel-check --ui` does not run on this machine**: the Chromium the script bundles aborts on
  `--single-process` while rendering the full SPA (the non-UI part of
  `node scripts/panel-check.mjs` verifies as usual: the plugin enters the boot graph, the bundle is
  served, the HTTP endpoints answer). The UI path is covered by manual checks in a real GUI plus
  the render cases in `test/panel.test.mjs`.
- **Most avatars are initial circles**: a message row carries only an `open_id`, and Feishu returns
  neither name nor avatar with it. Names come from the chat-member endpoint (no extra scope), but
  **other people's avatars** would need a contacts scope (`contact:user.base:readonly`) plus one
  re-authorization — so today only your own avatar (picked up during the token exchange) and the
  chat avatar try a real image; everyone else gets a circle coloured stably from their id. **When a
  name cannot be resolved, no colour and no name are invented**: a grey dashed circle plus
  "unknown member", because pairing an id hash with a colour and truncating the id into a nickname
  feels exactly like making a person up.
- **Whether the model tools are visible to a session depends on the composition**: the Web surface
  moves tools onto the agent-preset plane, so a host-plane registration does not always take
  effect. `toolsEnabled: false` turns them off.
- **No persistent cache**: tasks and the chat list are in-memory caches (60 / 120 seconds) and are
  re-read after a restart; member names are cached for 10 minutes.
- **Thread (topic) messages are not supported**: history is read with `container_id_type=chat` for
  the main conversation only; `thread_id` is passed through but no tree is built.
- **At most the newest 300 messages are rendered**: the backend cap is still 2000, the extra rows
  are announced as "showing the newest N", and there is no virtualization.
- **An empty input never changes the configuration**: so there is no way to "restore a default" by
  clearing a field — edit `settings.yaml` directly instead.

## License

MIT.
