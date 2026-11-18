# SuperAgent Work Context

A detachable DeepSeek Harness bundle for the SuperAgent profile. It reads the configured SuperAgent bot's joined Feishu groups, keeps a durable cross-group work context, and optionally sends direct reminders to one configured owner.

Derived from [zjuatri/dsh-feishu-plugin](https://github.com/zjuatri/dsh-feishu-plugin/tree/5d125c853c340e9534dbf40456eb90d78ab728a0). It reuses the upstream group-history API mappings, message rendering, and native DSH model streaming. The upstream MIT license and copyright are included.

## Install and configure

Requires Node 22.19+ and a running dsh-superagent profile with a configured Feishu Source. Install the archive through Plugin Manager in that profile, or use the DSH CLI.

    dsh plugin --profile superagent add /absolute/path/dsh-superagent-work-context-0.1.1.tgz

In Plugin Configuration select **SuperAgent Work Context**. Supply the ownerId open ID for the bot app and the owner's display name. Set enabled to true to start. Keep deliverPrivate false while checking the snapshot, then enable delivery for qualified reminders. Disable the bundle to stop collection and review. Its state remains on disk.

| Setting | Default | Purpose |
| --- | --- | --- |
| enabled | false | Run collection and model review in the SuperAgent host |
| deliverPrivate | false | Deliver qualified reminders to the configured owner |
| ownerId, ownerName | Required when enabled | Recipient open ID and name used in conversation |
| stateDir | work-context under the SuperAgent state directory | SQLite database and snapshot |
| intervalMinutes | 30 | Poll interval, with at most one in-flight cycle |
| bootstrapDays | 14 | Initial history window for each group |
| threadLimit | 120 | Number of known threads to rotate through each cycle |
| provider, model | deepseek-official, deepseek-flash | DSH model route for evidence review |
| legacyDb | Unset | Absolute path to the old Python global-context SQLite database, imported before the first native sync |

The bundle uses the SuperAgent Feishu Source's existing bot CLI and credentials. The bot needs permission to read its joined groups, histories, and associated documents or Minutes. Delivery additionally requires permission to send private messages. The configured DSH model route receives the evidence included in analysis. Permission failures and unsupported attachments are visible in the local snapshot.

## Behavior and data

Each cycle discovers groups, advances independent cursors after successful reads, rotates old threads, and records accessible meeting notes and transcripts. The plugin passes evidence to the configured DSH model in bounded batches, carrying forward stable issue keys and the previous context. A current human or meeting source must support each reminder. Dispatch runs after review of the full increment, allowing completion in another group to cancel a pending notification. SQLite keeps historical versions and delivery receipts. After an ambiguous send, the plugin retries the exact payload and Feishu idempotency key within the provider window. Older ambiguous outcomes appear as uncertain and need manual reconciliation.

The current.json snapshot contains facts, actions, evidence links, coverage gaps and delivery totals. The current.txt file renders the same work context for direct reading. The source of truth is context.sqlite3. The state directory is bound to the bot and recipient, so each independent deployment needs its own directory.

For a migration, stop the old scheduler before enabling native delivery. The first native run reads the old database in read-only mode, imports evidence from still-joined groups, and carries over reviewed action keys and sent or ambiguous receipts. Review the snapshot before enabling delivery. Reconcile any unattempted queue entries in the old scheduler before cutover.

## Build and test

    pnpm install --frozen-lockfile
    pnpm test
    npm pack

The archive includes the native host entry, bundle patch, source modules, icon, and upstream license. Tests simulate Feishu and the DSH model stream.
