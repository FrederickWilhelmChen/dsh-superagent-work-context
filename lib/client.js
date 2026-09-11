//! Hand-authored client bundle in the DSH lazy-CJS plugin format.
//!
//! Executing this file only REGISTERS a factory; nothing runs until the module
//! system materializes the plugin. The wrapper, the `id`, and the
//! `apply`/`inject` exports are the whole contract
//! (`@deepseek-ai/dsh-client-modules/lib/types/client/manifest.d.ts`).
//!
//! Only platform-seed specifiers may be required: `react`, `react/jsx-runtime`,
//! `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`,
//! `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
//! `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`.
//! Anything else must be bundled in (as the styles below are) or declared in
//! `dsh.client.external` naming another client package row.
window.__ModuleLoader__.load({
  id: 'dsh-feishu-plugin',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;

    // ── styles ──────────────────────────────────────────────────────────────
    // Inlined CSS rather than a stylesheet: a third-party plugin has no build
    // step to hash CSS-module class names, and one <style> tag keeps the panel
    // self-contained. `data-plugin` must be this exact package name — that is
    // the key the client HMR driver removes stale tags by.
    const CSS = [
      // Palette: DSH's own tokens, blue-forward. Three token names this build
      // does not define (`--dsw-alias-state-error-tertiary`, `--dsw-alias-warn-label`,
      // `--dsw-alias-warn-primary`) used to leave those rules colourless, so
      // every rule below is either a token that exists in
      // `@deepseek-ai/dsh-client-ui-theme` or carries a literal fallback.
      //
      // The palette is declared on every plugin-classed container rather than
      // only on the panel root: the header button and the settings card live
      // outside `.dsh-feishu-root`, and a `var()` that resolves nowhere would
      // silently drop the blue and leave the light-theme fallbacks in dark mode.
      '.dsh-feishu-root,.dsh-feishu-card,.dsh-feishu-btn,.dsh-feishu-footBtn{--ff-accent:var(--dsw-alias-state-business-primary,#4176e6);--ff-accent-soft:var(--dsw-alias-state-business-tertiary,#e4edfd);--ff-accent-line:var(--dsw-static-deepseek-200,#d3e2ff);--ff-ok:var(--dsw-alias-state-success-primary,#22c55e);--ff-ok-soft:var(--dsw-alias-state-success-tertiary,#e6faed);--ff-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--ff-warn-text:var(--dsw-alias-state-warn-label,#dd8629);--ff-warn-soft:var(--dsw-alias-state-warn-tertiary,#fef5e7);--ff-bad:var(--dsw-alias-state-error-primary,#e5484d);--ff-bad-soft:#e5484d1f;--ff-line:var(--dsw-alias-border-l2,#0000001a);--ff-line-strong:var(--dsw-alias-border-l3,#0000001f);--ff-surface:var(--dsw-alias-bg-layer-1,#fff);--ff-surface-2:var(--dsw-alias-bg-layer-3,#f9fafb);--ff-shadow:0 8px 28px #0f11151f,0 1px 2px #0f11150f;--ff-avatar-hue:210}',
      '.dsh-feishu-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--dsw-font-family);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);font-size:var(--dsw-font-s-14-font-size,13px)}',
      // The left sidebar's foot entry. Its geometry copies the shell's own footer
      // row (42px tall, 12px radius, 16px glyph), because it sits in the same
      // strip as Settings and a different shape there would read as a foreign
      // widget.
      '.dsh-feishu-footBtn{display:flex;align-items:center;gap:8px;height:42px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease}',
      '.dsh-feishu-footBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--ff-accent)}',
      '.dsh-feishu-footBtn:focus-visible{outline:2px solid var(--ff-accent);outline-offset:1px}',
      '.dsh-feishu-footBtn[data-wide="false"]{width:42px;justify-content:center;padding:0}',
      '.dsh-feishu-footLabel{font-size:13px}',
      // The brand mark keeps its own colours, so it is an image rather than a
      // glyph: `display:block` kills the inline baseline gap the row would
      // otherwise inherit from it.
      '.dsh-feishu-mark{display:block;flex:0 0 auto;object-fit:contain}',
      // The rail's page fills the centre column; its content keeps a readable
      // measure instead of stretching a task list across a wide window.
      '.dsh-feishu-main{height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--dsw-font-family)}',
      '.dsh-feishu-main>*{width:100%;max-width:820px;margin:0 auto}',
      // Segmented control, the shape DSH uses for view switches: a tinted track
      // with a white pill on the active item.
      '.dsh-feishu-tabs{display:flex;gap:2px;margin:10px 10px 0;padding:2px;border-radius:9px;background:var(--dsw-static-neutral-bluish-60,var(--ff-surface-2));flex:0 0 auto}',
      '.dsh-feishu-tab{flex:1 1 0;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font:inherit;padding:6px 10px;border-radius:7px;cursor:pointer;transition:background .15s ease,color .15s ease}',
      '.dsh-feishu-tab:hover{color:var(--ff-accent);background:var(--ff-accent-soft)}',
      '.dsh-feishu-tab:focus-visible{outline:2px solid var(--ff-accent);outline-offset:1px}',
      '.dsh-feishu-tab[data-active="true"]{color:var(--ff-accent);background:var(--ff-surface);box-shadow:0 1px 2px #0f111514;font-weight:600}',
      '.dsh-feishu-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px;flex:0 0 auto}',
      '.dsh-feishu-btn{appearance:none;border:.5px solid var(--ff-line-strong);background:var(--ff-surface);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;padding:4px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease,filter .15s ease}',
      '.dsh-feishu-btn:hover:not(:disabled){color:var(--ff-accent);border-color:var(--ff-accent);background:var(--ff-accent-soft)}',
      '.dsh-feishu-btn:focus-visible{outline:2px solid var(--ff-accent);outline-offset:1px}',
      '.dsh-feishu-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.dsh-feishu-btn[data-variant="primary"]{background:var(--ff-accent);border-color:transparent;color:#fff}',
      '.dsh-feishu-btn[data-variant="primary"]:hover:not(:disabled){background:var(--ff-accent);border-color:transparent;color:#fff;filter:brightness(1.08)}',
      // The header entry sits among DSH's own ghost buttons, so it is tinted
      // rather than filled: blue enough to be found, quiet enough not to shout.
      '.dsh-feishu-btn[data-variant="tinted"]{color:var(--ff-accent);background:var(--ff-accent-soft);border-color:var(--ff-accent-line)}',
      '.dsh-feishu-btn[data-variant="tinted"]:hover:not(:disabled){color:var(--ff-accent);background:var(--ff-accent-soft);border-color:var(--ff-accent);filter:brightness(.98)}',
      '.dsh-feishu-btn[data-done="true"]{background:var(--ff-ok-soft);border-color:var(--ff-ok);color:var(--ff-ok)}',
      // The completion effect: the row holds its green state just long enough to
      // read as "this landed in Feishu", then collapses out of the list.
      '.dsh-feishu-complete[data-state="pending"]{color:var(--ff-accent);border-color:var(--ff-accent-line);background:var(--ff-accent-soft)}',
      '.dsh-feishu-complete[data-state="done"]{color:#fff;border-color:transparent;background:var(--ff-ok)}',
      '.dsh-feishu-spin{display:inline-block;width:10px;height:10px;margin-right:4px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;vertical-align:-1px;animation:dsh-feishu-spin .7s linear infinite}',
      '.dsh-feishu-body{flex:1 1 auto;min-height:0;overflow:auto;padding:0 10px 14px}',
      '.dsh-feishu-body::-webkit-scrollbar{width:8px;height:8px}',
      '.dsh-feishu-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#e1e5ee);border-radius:4px}',
      '.dsh-feishu-body::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,#cfd3d6)}',
      '.dsh-feishu-row{position:relative;display:flex;align-items:flex-start;gap:8px;padding:9px 8px;border-radius:8px;border-bottom:.5px solid var(--dsw-alias-border-l1,#0000000a);transition:background .15s ease}',
      '.dsh-feishu-row:last-child{border-bottom-color:transparent}',
      '.dsh-feishu-row:hover{background:var(--ff-accent-soft)}',
      '.dsh-feishu-row[data-state="pending"]{background:var(--ff-accent-soft);box-shadow:inset 2px 0 0 0 var(--ff-accent)}',
      '.dsh-feishu-row[data-state="done"]{background:var(--ff-ok-soft);box-shadow:inset 2px 0 0 0 var(--ff-ok);overflow:hidden;animation:dsh-feishu-rowOut .45s ease .55s forwards}',
      '.dsh-feishu-row-main{flex:1 1 auto;min-width:0}',
      '.dsh-feishu-title{line-height:1.5;word-break:break-word}',
      '.dsh-feishu-title[data-done="true"]{text-decoration:line-through;color:var(--dsw-alias-label-tertiary,#adb2b8)}',
      '.dsh-feishu-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-chip{border:0;border-radius:999px;padding:1px 8px;background:var(--dsw-static-neutral-bluish-75,#f1f3f5);color:var(--dsw-alias-label-secondary,#61666b)}',
      '.dsh-feishu-chip[data-tone="accent"]{background:var(--ff-accent-soft);color:var(--ff-accent)}',
      '.dsh-feishu-chip[data-tone="warn"]{background:var(--ff-warn-soft);color:var(--ff-warn-text)}',
      '.dsh-feishu-chip[data-tone="high"]{background:var(--ff-bad-soft);color:var(--ff-bad)}',
      '.dsh-feishu-note{margin:10px 2px;padding:9px 11px;border-radius:9px;background:var(--ff-surface-2);color:var(--dsw-alias-label-secondary,#61666b);border-left:2px solid var(--ff-line-strong);line-height:1.6;font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-note[data-tone="error"]{background:var(--ff-bad-soft);color:var(--ff-bad);border-left-color:var(--ff-bad)}',
      '.dsh-feishu-note[data-tone="success"]{background:var(--ff-ok-soft);color:var(--ff-ok);border-left-color:var(--ff-ok)}',
      '.dsh-feishu-note[data-tone="warn"]{background:var(--ff-warn-soft);color:var(--ff-warn-text);border-left-color:var(--ff-warn)}',
      '.dsh-feishu-empty{padding:28px 10px;text-align:center;color:var(--dsw-alias-label-tertiary,#adb2b8);line-height:1.7;font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-section{margin:12px 2px 4px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-summary{margin:6px 2px;padding:10px 12px;border-radius:9px;background:var(--ff-surface);border:.5px solid var(--ff-line);line-height:1.65}',
      '.dsh-feishu-select{appearance:none;border:.5px solid var(--ff-line-strong);background:var(--ff-surface);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;padding:4px 8px;border-radius:7px;max-width:100%}',
      '.dsh-feishu-select:focus-visible,.dsh-feishu-input:focus-visible{border-color:var(--ff-accent);outline:none;box-shadow:0 0 0 3px var(--ff-accent-soft)}',
      '.dsh-feishu-input{flex:1 1 160px;min-width:0;border:.5px solid var(--ff-line-strong);background:var(--ff-surface);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;padding:5px 9px;border-radius:7px}',
      '.dsh-feishu-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:100%}',
      '.dsh-feishu-kv{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px);padding:0 2px 6px}',
      '.dsh-feishu-code{margin:6px 2px;padding:9px 11px;border-radius:9px;background:var(--dsw-alias-markdown-code-block,#f9fafb);border:.5px solid var(--ff-line);color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow:auto}',
      '.dsh-feishu-details{margin:8px 2px;border:.5px solid var(--ff-line);border-radius:9px;background:var(--ff-surface);overflow:hidden}',
      '.dsh-feishu-summaryLine{cursor:pointer;padding:9px 11px;color:var(--dsw-alias-label-secondary,#61666b);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.5;list-style:none}',
      '.dsh-feishu-summaryLine::-webkit-details-marker{display:none}',
      '.dsh-feishu-detailsBody{padding:0 11px 11px}',
      '.dsh-feishu-list{margin:0;padding-left:18px;line-height:1.7}',
      // A second-level segmented control inside the chats tab: same segment
      // language as the panel's own tabs, one size down.
      '.dsh-feishu-subtabs{margin:2px 2px 8px}',
      // ── chat view ──────────────────────────────────────────────────────────
      // The thread reads like a chat app: day separators, an avatar column on
      // the sender's side, and bubbles that keep the conversation's own line
      // breaks. Own messages mirror to the right.
      '.dsh-feishu-threadHead{display:flex;align-items:center;gap:10px;padding:4px 2px 10px;border-bottom:.5px solid var(--ff-line);margin-bottom:8px}',
      '.dsh-feishu-threadAvatar{display:flex}',
      '.dsh-feishu-threadMeta{min-width:0}',
      '.dsh-feishu-threadName{font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);line-height:1.4;overflow-wrap:anywhere}',
      '.dsh-feishu-messages{display:flex;flex-direction:column;gap:0}',
      '.dsh-feishu-msgNote{margin:4px 2px 8px;padding:6px 10px;border-radius:8px;background:var(--ff-surface-2);color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px);text-align:center}',
      // Tight on purpose: a chat column is read as a rhythm, and every pixel of
      // row padding is a pixel of conversation the panel cannot show.
      '.dsh-feishu-msg{position:relative;display:flex;gap:8px;padding:1px 2px 3px;align-items:flex-start}',
      '.dsh-feishu-msg[data-self="true"]{flex-direction:row-reverse}',
      '.dsh-feishu-msgAvatarSlot{width:28px;flex:0 0 auto}',
      '.dsh-feishu-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:0 0 auto}',
      '.dsh-feishu-avatarText{display:inline-flex;align-items:center;justify-content:center;background:hsl(var(--ff-avatar-hue,210) 58% 46%);color:#fff;font-size:11px;line-height:1;letter-spacing:.02em;user-select:none}',
      '.dsh-feishu-avatarUnknown{background:var(--ff-surface-2);color:var(--dsw-alias-label-secondary,#8a8f98);border:1px dashed var(--ff-line-strong)}',
      '.dsh-feishu-msgSender[data-unknown="true"]{color:var(--dsw-alias-label-secondary,#8a8f98);font-weight:500}',
      '.dsh-feishu-msgMain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px}',
      '.dsh-feishu-msg[data-self="true"] .dsh-feishu-msgMain{align-items:flex-end}',
      '.dsh-feishu-msgHead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;line-height:1.3}',
      '.dsh-feishu-msgSender{color:var(--dsw-alias-label-secondary,#61666b);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-msgTime{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:11px}',
      '.dsh-feishu-bubble{max-width:82%;border-radius:12px;padding:5px 10px;background:var(--ff-surface-2);color:var(--dsw-alias-label-primary,#0f1115);line-height:1.45;font-size:var(--dsw-font-s-14-font-size,13px);overflow-wrap:anywhere;border:.5px solid var(--ff-line)}',
      '.dsh-feishu-msg[data-self="true"] .dsh-feishu-bubble{background:var(--ff-accent-soft);border-color:var(--ff-accent-line)}',
      '.dsh-feishu-bubble[data-kind="recalled"]{color:var(--dsw-alias-label-tertiary,#adb2b8)}',
      '.dsh-feishu-line+.dsh-feishu-line{margin-top:2px}',
      '.dsh-feishu-mention{color:var(--ff-accent);font-weight:500}',
      '.dsh-feishu-link{color:var(--ff-accent);text-decoration:underline;word-break:break-all}',
      '.dsh-feishu-quote{max-width:82%;display:flex;gap:6px;align-items:baseline;padding:3px 9px;border-left:2px solid var(--ff-accent-line);border-radius:6px;background:var(--ff-surface-2);color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px);overflow:hidden}',
      '.dsh-feishu-quoteWho{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#61666b)}',
      '.dsh-feishu-quoteText{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-feishu-quoteMissing{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:11px;font-style:italic}',
      '.dsh-feishu-recalled{display:flex;justify-content:center;padding:3px 0;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-media{display:block;max-width:82%}',
      '.dsh-feishu-mediaImage{display:block;max-width:100%;max-height:240px;border-radius:10px;border:.5px solid var(--ff-line)}',
      '.dsh-feishu-mediaFailed{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-fileCard{display:flex;flex-direction:column;gap:6px;min-width:180px;padding:8px 10px;border-radius:10px;background:var(--ff-surface);border:.5px solid var(--ff-line)}',
      '.dsh-feishu-fileRow{display:flex;gap:8px;align-items:baseline;justify-content:space-between}',
      '.dsh-feishu-fileName{min-width:0;overflow-wrap:anywhere;font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-fileMeta{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:11px}',
      '.dsh-feishu-fileLink{color:var(--ff-accent);font-size:var(--dsw-font-xxs-12-font-size,12px)}',
      '.dsh-feishu-audio,.dsh-feishu-video{max-width:100%;border-radius:8px}',
      '.dsh-feishu-video{max-height:220px}',
      // The row action rides beside the bubble, floated over the row's outer
      // edge: stacked under the bubble it cost every message a button's height,
      // and reserving a gutter for it would eat a narrow panel's width.
      '.dsh-feishu-msgActions{position:absolute;top:1px;right:0;z-index:2;opacity:0;transition:opacity .12s ease}',
      '.dsh-feishu-msg[data-self="true"] .dsh-feishu-msgActions{right:auto;left:0}',
      '.dsh-feishu-msg:hover .dsh-feishu-msgActions,.dsh-feishu-msg:focus-within .dsh-feishu-msgActions{opacity:1}',
      '.dsh-feishu-msgActions .dsh-feishu-btn{box-shadow:0 1px 3px #0f111514}',
      '.dsh-feishu-msgEnd{height:1px}',
      // The completion toast: it is the panel's answer to "did the click do
      // anything in Feishu?", so it arrives with a pop rather than silently.
      '.dsh-feishu-toast{position:absolute;left:12px;right:12px;bottom:12px;z-index:20;display:flex;align-items:flex-start;gap:9px;padding:10px 11px;border-radius:10px;background:var(--ff-surface);border:.5px solid var(--ff-ok);box-shadow:var(--ff-shadow);animation:dsh-feishu-toastIn .22s ease-out}',
      '.dsh-feishu-toast[data-tone="error"]{border-color:var(--ff-bad)}',
      '.dsh-feishu-toastTick{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--ff-ok);color:#fff;font-size:12px;line-height:1;animation:dsh-feishu-pop .34s cubic-bezier(.34,1.56,.64,1)}',
      '.dsh-feishu-toast[data-tone="error"] .dsh-feishu-toastTick{background:var(--ff-bad)}',
      '.dsh-feishu-toastBody{flex:1 1 auto;min-width:0}',
      '.dsh-feishu-toastText{color:var(--dsw-alias-label-primary,#0f1115);font-size:var(--dsw-font-xxs-12-font-size,12px);font-weight:600;line-height:1.5}',
      '.dsh-feishu-toastDetail{margin-top:2px;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.5;overflow-wrap:anywhere}',
      '.dsh-feishu-toastClose{flex:0 0 auto;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:14px;line-height:1;padding:2px 5px;border-radius:6px;cursor:pointer}',
      '.dsh-feishu-toastClose:hover{background:var(--ff-line);color:var(--dsw-alias-label-primary,#0f1115)}',
      '@keyframes dsh-feishu-toastIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}',
      '@keyframes dsh-feishu-pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}',
      '@keyframes dsh-feishu-spin{to{transform:rotate(360deg)}}',
      '@keyframes dsh-feishu-rowOut{from{opacity:1;max-height:160px}to{opacity:0;max-height:0;padding-top:0;padding-bottom:0;border-bottom-width:0}}',
      '@media (prefers-reduced-motion:reduce){.dsh-feishu-toast,.dsh-feishu-toastTick,.dsh-feishu-spin,.dsh-feishu-row[data-state="done"]{animation:none}}',
      // Settings card: registered into the Plugins section's card slot, so the
      // plugin has a real form instead of only a YAML file.
      '.dsh-feishu-card{display:flex;flex-direction:column;gap:10px;max-width:640px}',
      '.dsh-feishu-field{display:flex;flex-direction:column;gap:4px;padding:10px 0}',
      '.dsh-feishu-field+.dsh-feishu-field{border-top:.5px solid var(--ff-line)}',
      '.dsh-feishu-fieldLabel{color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;font-weight:500;line-height:1.5}',
      '.dsh-feishu-fieldHint{color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:12px;line-height:1.5}',
      '.dsh-feishu-fieldInput{border:.5px solid var(--ff-line-strong);background:var(--ff-surface);height:34px;font:inherit;color:var(--dsw-alias-label-primary,#0f1115);border-radius:8px;padding:0 12px;font-size:13px;min-width:0;transition:border-color .15s ease,box-shadow .15s ease}',
      '.dsh-feishu-fieldInput:focus-visible{border-color:var(--ff-accent);outline:none;box-shadow:0 0 0 3px var(--ff-accent-soft)}',
      '.dsh-feishu-footer{display:flex;align-items:center;gap:8px;justify-content:flex-end;border-top:.5px solid var(--ff-line);padding-top:10px}',
      '.dsh-feishu-status{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary,#adb2b8);font-size:12px;line-height:1.5}',
      '.dsh-feishu-status[data-tone="error"]{color:var(--ff-bad)}',
      '.dsh-feishu-status[data-tone="ok"]{color:var(--ff-ok)}',
    ].join('\n');
    const STYLE_TAG_ID = 'dsh-feishu-plugin/panel.css';
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-feishu-plugin';
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── copy ────────────────────────────────────────────────────────────────
    const zh = {
      'tab.title': '飞书',
      'tab.guide': '飞书任务与群聊总结',
      'tab.guide.description': '读取飞书任务、总结机器人所在群聊',
      'view.tasks': '我的任务',
      'view.chats': '群聊总结',
      'view.messages': '聊天记录',
      'view.summary': 'AI 摘要',
      'action.refresh': '刷新',
      'action.login': '登录飞书',
      'action.logout': '退出登录',
      'action.summarize': 'DeepSeek 一键总结',
      'action.complete': '完成',
      'action.complete.hint': '在飞书里真的把这条任务标记为完成（会写入飞书，不只是隐藏这一行）。需要 task:task:write 权限，否则会提示重新授权。',
      'action.completing': '同步中…',
      'action.completed': '已完成',
      'toast.completed': '已在飞书标记完成',
      'toast.failed': '标记完成失败',
      'toast.dismiss': '关闭提示',
      'action.insert': '加入输入框',
      'action.inserted': '已加入',
      'action.insertHint': '把这条内容追加到当前会话的输入框，不会自动发送。',
      'action.insertUnavailable': '这个页面没有会话输入框：进入一个会话后，点左侧栏底部的「飞书」，面板会在右侧打开，那里可以直接插入。',
      'panel.noSession': '当前没有会话，所以这里只做展示：任务和群聊总结照样能用。进入一个会话后，点左侧栏底部的「飞书」，同一个面板会在右侧打开——那里才有输入框可以插入。',
      'action.fetchMessages': '拉取聊天记录',
      'action.openAuth': '打开授权页',
      'action.submitCallback': '用回调地址兑换',
      'loading': '加载中…',
      'empty.tasks': '没有未完成的任务。',
      'empty.chats': '机器人还没有加入任何群聊。',
      'empty.messages': '这个时间范围内没有消息。可以把「时间范围」调大一点。',
      'empty.thread': '还没有拉取这个群的聊天记录。',
      'msg.me': '我',
      'msg.app': '应用',
      'msg.recalled': '撤回了一条消息',
      'msg.recalledShort': '（已撤回）',
      'msg.quoteMissing': '回复了更早的消息',
      'msg.image': '图片消息',
      'msg.imageFailed': '图片加载失败（可能已过期或机器人不在群里）',
      'msg.download': '下载 / 打开',
      'msg.capped': '只显示最近 {shown} 条（共 {total} 条）',
      'msg.namesFailed': '昵称读取失败',
      'msg.namesFailedHint': '群成员列表读不到，发送者会显示为「未知成员」',
      'msg.unknownSender': '未知成员',
      'msg.unknownSenderHint': '部分发送者不在可读的群成员列表里（机器人、外部成员，或成员列表权限不足）',
      'day.today': '今天',
      'day.yesterday': '昨天',
      'day.week1': '周日',
      'day.week2': '周一',
      'day.week3': '周二',
      'day.week4': '周三',
      'day.week5': '周四',
      'day.week6': '周五',
      'day.week7': '周六',
      'empty.summary': '还没有总结。先选一个群，再点「DeepSeek 一键总结」。',
      'hint.unconfigured': '还没有配置飞书应用。在本仓库目录里运行这条命令（settings.yaml 是热加载的，不用重启）：',
      'hint.unconfiguredManual': '或者直接编辑 $DSH_HOME/settings.yaml，加上这一段：',
      'hint.copy': '复制命令',
      'hint.copied': '已复制',
      'hint.notLoggedIn': '尚未登录飞书。当前任务来自应用可读的任务清单；点「登录飞书」后可以看到「我负责的」任务。',
      'hint.login1': '第 1 步：点「打开授权页」，在飞书里点「授权」。',
      'hint.login2': '第 2 步：授权后浏览器会跳到回调地址（可能显示报错页，忽略它），把地址栏里的完整 URL 复制粘贴到下面。',
      'hint.missingScopes': '当前授权缺少这些权限：{scopes}。需要在飞书开发者后台开通并**发布版本**，然后重启 dsh web 并重新授权——旧 token 的权限不会自动增加。',
      'auth.title': '飞书授权（读取「我负责的」任务需要）',
      'auth.loggedIn': '已登录飞书：{name}（点开可重新授权）',
      'label.chat': '群聊',
      'label.range': '时间范围',
      'label.limit': '最多消息数',
      'range.24h': '最近 24 小时',
      'range.3d': '最近 3 天',
      'range.7d': '最近 7 天',
      'range.30d': '最近 30 天',
      'label.source.myTasks': '来源：我负责的',
      'label.source.tasklists': '来源：任务清单',
      'label.due': '截止',
      'label.overdue': '已逾期',
      'label.list': '清单',
      'label.summary': '摘要',
      'label.keyPoints': '关键点',
      'label.actionItems': '待办任务',
      'label.messages': '条消息',
      'label.truncated': '已截断',
      'label.owner': '负责人',
      'label.model': '模型',
      'error.title': '操作失败',
      'error.tasksFailed': '任务列表读取失败（这不等于你没有任务）',
      'note.noLlm': '当前组合没有可用的 LLM 服务，无法总结。',
      // Settings card (the Plugins settings section's card slot).
      'settings.intro': '在飞书开放平台创建企业自建应用后，把凭证填在这里。保存后立即生效（settings.yaml 是热加载的）。',
      'settings.appId': 'App ID',
      'settings.appId.hint': '开发者后台 → 凭证与基础信息 → App ID，形如 cli_xxxxx。',
      'settings.appSecret': 'App Secret',
      'settings.appSecret.hint': '出于安全考虑不会回显。留空表示保持已保存的值不变；要换就填新的。',
      'settings.baseUrl': '开放平台地址',
      'settings.baseUrl.hint': '国内版 https://open.feishu.cn；Lark 国际版 https://open.larksuite.com。',
      'settings.redirect': '重定向 URL（填应用后台白名单里的地址）',
      'settings.redirect.hint': '必须和飞书后台「安全设置 → 重定向 URL」里的某一条完全一致：授权和兑换两次请求都会带上它。留空则两次都不带（会被飞书拒绝 20029/20063）。',
      'settings.maxMessages': '单次总结最多消息数',
      'settings.maxMessages.hint': '10–2000，默认 200。留空表示用默认值。',
      'settings.summaryModel': '总结用的模型（可选）',
      'settings.summaryModel.hint': '留空则用 DSH 的默认模型。',
      'settings.tools': '注册模型工具',
      'settings.tools.hint': '开启后向模型提供 feishu_tasks / feishu_summarize。是否对会话可见取决于组合。',
      'settings.loading': '正在读取设置…',
      'settings.unavailable': '本部署没有向浏览器开放这个设置命名空间，请改用 scripts/apply-settings.mjs 或直接编辑 settings.yaml。',
      'settings.readOnly': '当前部署的设置为只读。',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.saved': '已保存',
      'settings.saveFailed': '保存失败',
      'settings.invalidNumber': '请填数字，或留空使用默认值。',
    };
    const en = {
      'tab.title': 'Feishu',
      'tab.guide': 'Feishu tasks & chat summary',
      'tab.guide.description': 'Read Feishu tasks and summarize bot group chats',
      'view.tasks': 'My tasks',
      'view.chats': 'Chat summary',
      'view.messages': 'Messages',
      'view.summary': 'AI summary',
      'action.refresh': 'Refresh',
      'action.login': 'Sign in to Feishu',
      'action.logout': 'Sign out',
      'action.summarize': 'Summarize with DeepSeek',
      'action.complete': 'Complete',
      'action.complete.hint': 'Marks this task completed in Feishu itself — it writes to Feishu, not just hides the row. Requires task:task:write, otherwise it asks you to re-authorize.',
      'action.completing': 'Syncing…',
      'action.completed': 'Completed',
      'toast.completed': 'Marked completed in Feishu',
      'toast.failed': 'Could not mark it completed',
      'toast.dismiss': 'Dismiss',
      'action.insert': 'Add to input',
      'action.inserted': 'Added',
      'action.insertHint': 'Appends this line to the current composer draft; nothing is sent.',
      'action.insertUnavailable': 'No composer on this page: open a session, then use “Feishu” at the foot of the left sidebar — the panel opens on the right, where insertion works.',
      'panel.noSession': 'No session is open, so this page only shows what needs none: tasks and chat summaries. Inside a session, “Feishu” at the foot of the left sidebar opens the same panel on the right, where 「Add to input」 has a composer to write into.',
      'action.fetchMessages': 'Fetch messages',
      'action.openAuth': 'Open authorize page',
      'action.submitCallback': 'Exchange callback URL',
      'loading': 'Loading…',
      'empty.tasks': 'No open tasks.',
      'empty.chats': 'The bot has not joined any group chat yet.',
      'empty.messages': 'No messages in this range. Try a wider time range.',
      'empty.thread': 'This chat has not been read yet.',
      'msg.me': 'Me',
      'msg.app': 'App',
      'msg.recalled': 'recalled a message',
      'msg.recalledShort': '(recalled)',
      'msg.quoteMissing': 'Replied to an earlier message',
      'msg.image': 'Image message',
      'msg.imageFailed': 'Image failed to load (it may be expired, or the bot may have left the chat)',
      'msg.download': 'Download / open',
      'msg.capped': 'Showing the newest {shown} of {total}',
      'msg.namesFailed': 'names unavailable',
      'msg.namesFailedHint': 'The member list could not be read, so senders show as unknown',
      'msg.unknownSender': 'Unknown member',
      'msg.unknownSenderHint': 'Some senders are not in the readable member list (bots, external members, or a missing member-list permission)',
      'day.today': 'Today',
      'day.yesterday': 'Yesterday',
      'day.week1': 'Sun',
      'day.week2': 'Mon',
      'day.week3': 'Tue',
      'day.week4': 'Wed',
      'day.week5': 'Thu',
      'day.week6': 'Fri',
      'day.week7': 'Sat',
      'empty.summary': 'Nothing summarized yet. Pick a chat, then press “Summarize with DeepSeek”.',
      'hint.unconfigured': 'Feishu is not configured. Run this in the plugin repository (settings.yaml is hot-reloaded; no restart needed):',
      'hint.unconfiguredManual': 'Or edit $DSH_HOME/settings.yaml and add this section:',
      'hint.copy': 'Copy command',
      'hint.copied': 'Copied',
      'hint.notLoggedIn': 'Not signed in. Tasks currently come from app-readable task lists; sign in to see “assigned to me”.',
      'hint.login1': 'Step 1: press “Open authorize page” and approve access in Feishu.',
      'hint.login2': 'Step 2: the browser then lands on the callback address (it may show an error page — ignore it). Copy that whole URL from the address bar and paste it below.',
      'hint.missingScopes': 'This grant is missing: {scopes}. Enable them in the Feishu developer console and publish a version, then restart dsh web and authorize again — an existing token never gains new permissions.',
      'auth.title': 'Feishu authorization (needed to read “assigned to me”)',
      'auth.loggedIn': 'Signed in to Feishu: {name} (open to authorize again)',
      'label.chat': 'Chat',
      'label.range': 'Range',
      'label.limit': 'Max messages',
      'range.24h': 'Last 24 hours',
      'range.3d': 'Last 3 days',
      'range.7d': 'Last 7 days',
      'range.30d': 'Last 30 days',
      'label.source.myTasks': 'Source: assigned to me',
      'label.source.tasklists': 'Source: task lists',
      'label.due': 'Due',
      'label.overdue': 'Overdue',
      'label.list': 'List',
      'label.summary': 'Summary',
      'label.keyPoints': 'Key points',
      'label.actionItems': 'Action items',
      'label.messages': 'messages',
      'label.truncated': 'truncated',
      'label.owner': 'Owner',
      'label.model': 'Model',
      'error.title': 'Request failed',
      'error.tasksFailed': 'Reading the task list failed (this does not mean you have no tasks)',
      'note.noLlm': 'This composition has no LLM service available, so summarization is off.',
      'settings.intro': 'Fill in the credentials of a Feishu custom app. Saving takes effect immediately — settings.yaml is hot-reloaded.',
      'settings.appId': 'App ID',
      'settings.appId.hint': 'Developer console → Credentials & basic info → App ID, shaped like cli_xxxxx.',
      'settings.appSecret': 'App Secret',
      'settings.appSecret.hint': 'Never echoed back. Leave empty to keep the stored value; type a new one to replace it.',
      'settings.baseUrl': 'Open platform base URL',
      'settings.baseUrl.hint': 'Feishu: https://open.feishu.cn — Lark international: https://open.larksuite.com.',
      'settings.redirect': 'Redirect URL (must be whitelisted in the app console)',
      'settings.redirect.hint': 'Must match one entry of the app console’s Security → Redirect URLs exactly: both the authorize and the token exchange send it. Left empty, neither sends it — which Feishu rejects (20029/20063).',
      'settings.maxMessages': 'Max messages per summary',
      'settings.maxMessages.hint': '10–2000, default 200. Empty uses the default.',
      'settings.summaryModel': 'Summarization model (optional)',
      'settings.summaryModel.hint': 'Empty uses the DSH default model.',
      'settings.tools': 'Register model tools',
      'settings.tools.hint': 'Exposes feishu_tasks / feishu_summarize to the model. Whether a session sees them depends on the composition.',
      'settings.loading': 'Reading settings…',
      'settings.unavailable': 'This deployment does not expose the namespace to the browser; use scripts/apply-settings.mjs or edit settings.yaml instead.',
      'settings.readOnly': 'This deployment keeps settings read-only.',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.saved': 'Saved',
      'settings.saveFailed': 'Save failed',
      'settings.invalidNumber': 'Enter a number, or leave it empty for the default.',
    };

    const NS = 'feishu';
    const API = '/plugin/feishu';
    const TAB_KIND = 'feishu';
    const TAB_ID = 'dsh-feishu-plugin/panel';
    /**
     * The left sidebar's entry, and the `main` page it falls back to when there
     * is no session: the entry's identity is what the layout resolves that page
     * by.
     */
    const MAIN_PANEL_ID = 'dsh-feishu-plugin';
    /** Settings namespace; the card's key must match the host half's registration. */
    const SETTINGS_NAMESPACE = 'feishu-plugin';

    // ── host calls ──────────────────────────────────────────────────────────
    /**
     * Call one plugin API route and unwrap the `{ok, data}` envelope.
     * @param {string} path - route below the API prefix.
     * @param {any} [body] - JSON body for POST routes.
     * @returns {Promise<any>} the `data` field.
     */
    async function callApi(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.ok !== true) {
        const error = new Error(payload?.error?.message ?? 'unknown error');
        error.hint = payload?.error?.hint;
        throw error;
      }
      return payload.data;
    }

    /** Format a millisecond timestamp for a compact chip. */
    function formatDue(timestamp, allDay) {
      const date = new Date(timestamp);
      const pad = (value) => String(value).padStart(2, '0');
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return allDay ? day : `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** Append one block to the composer draft, keeping the user's own text. */
    function appendDraft(current, text) {
      const existing = typeof current === 'string' ? current : '';
      if (existing.trim().length === 0) return text;
      if (existing.endsWith('\n')) return `${existing}${text}`;
      return `${existing}\n${text}`;
    }

    /**
     * Render one projected task as a composer-ready line.
     *
     * The description is deliberately left out. A task created by an agent often
     * carries a whole essay there (meeting minutes, priority, a 妙记 token, a
     * source-task uuid), and pasting that into the composer buries the sentence
     * the user actually wanted. Nothing is lost by omitting it: the panel row
     * shows the title, the due date and the task list as chips, and the whole
     * description is still available in Feishu itself.
     *
     * @param {any} task - one normalized task.
     * @param {Function} t - translate function.
     * @returns {string} one checkbox line.
     */
    function taskToText(task, t) {
      const title = String(task?.title ?? '').replace(/\s*\n+\s*/g, ' ').trim();
      const parts = [`- [ ] ${title}`];
      if (typeof task?.due === 'number') parts.push(`（${t('label.due')} ${formatDue(task.due, task.dueAllDay)}）`);
      if (typeof task?.tasklistName === 'string' && task.tasklistName.length > 0) parts.push(`[${t('label.list')}: ${task.tasklistName}]`);
      return parts.join(' ');
    }

    /** Render one extracted action item as a composer-ready line. */
    function actionToText(item) {
      const suffix = [];
      if (typeof item.owner === 'string' && item.owner.length > 0) suffix.push(`负责人 ${item.owner}`);
      if (typeof item.due === 'string' && item.due.length > 0) suffix.push(`截止 ${item.due}`);
      return `- [ ] ${item.title}${suffix.length === 0 ? '' : `（${suffix.join('，')}）`}`;
    }

    // ── chat view formatting ────────────────────────────────────────────────
    /** Local-time `HH:mm` for one message timestamp. */
    function formatClock(at) {
      const date = new Date(at);
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    /** The local calendar day of a timestamp, as a sortable key. */
    function dayKey(at) {
      const date = new Date(at);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /** Day separator copy: 今天 / 昨天 / `2026-09-09 周三`. */
    function formatDayLabel(at, t) {
      const key = dayKey(at);
      if (key === dayKey(Date.now())) return t('day.today');
      if (key === dayKey(Date.now() - 86_400_000)) return t('day.yesterday');
      const weekday = t(`day.week${new Date(at).getDay() + 1}`);
      return `${key} ${weekday}`;
    }

    /**
     * One or two characters for an avatar circle.
     *
     * CJK names read best as their trailing characters (张三 → 张三, 欧阳修 → 阳修),
     * Latin ones as initials; anything else falls back to its first characters.
     * The circle exists so that a message is attributable even when no avatar
     * image is available, which is the normal case here.
     */
    function initials(name) {
      const text = String(name ?? '').trim();
      if (text.length === 0) return '?';
      if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return text.slice(-2);
      const words = text.split(/[\s._-]+/).filter((word) => word.length > 0);
      if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
      return text.slice(0, 2).toUpperCase();
    }

    /** A stable color for one sender, so the same person keeps the same circle. */
    function avatarHue(seed) {
      const text = String(seed ?? '');
      let hash = 0;
      for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360;
      return hash;
    }

    /**
     * Whether a row's sender name could not be resolved.
     *
     * The host marks these rows rather than dressing an id up as a name: a
     * truncated open id looks like a made-up handle next to real names, which is
     * exactly the impression this flag removes.
     *
     * @param {any} message - one projected message row.
     * @returns {boolean} true when no real name is known.
     */
    function senderUnknown(message) {
      if (message?.unresolved === true) return true;
      return typeof message?.senderName !== 'string' || message.senderName.length === 0;
    }

    /**
     * What to call a row's sender on screen.
     *
     * @param {any} message - one projected message row.
     * @param {Function} t - translate function.
     * @returns {string} the display name, or the neutral placeholder.
     */
    function senderLabel(message, t) {
      return senderUnknown(message) ? t('msg.unknownSender') : message.senderName;
    }

    /** Host URL of one message resource; the same route serves images and files. */
    function mediaUrl(message, type) {
      const key = type === 'image' ? message?.media?.imageKey : message?.media?.fileKey;
      if (typeof key !== 'string' || key.length === 0) return undefined;
      const query = new URLSearchParams({ messageId: String(message.id ?? ''), fileKey: key, type });
      if (type === 'file' && typeof message?.media?.fileName === 'string' && message.media.fileName.length > 0) {
        query.set('name', message.media.fileName);
      }
      return `${API}/api/media?${query.toString()}`;
    }

    /** One message as a composer-ready quote line. */
    function messageToText(message, t) {
      const when = message.at > 0 ? `${formatClock(message.at)} ` : '';
      const body = message.text.length > 0 ? message.text : t('msg.recalledShort');
      return `> [${when}]${senderLabel(message, t)}: ${body}`;
    }

    /**
     * Wire one "add to input" button to the session composer.
     * @param {object} props - a session-scope slot component's props.
     * @param {Function} t - translate function.
     * @returns {{ insert: (text: string) => void, inserted: string | null, available: boolean }} insertion face.
     */
    function useInsert(props, t) {
      const draft = props.useInput((state) => state.draft);
      const [inserted, setInserted] = react.useState(null);
      const timer = react.useRef(null);
      react.useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current);
      }, []);
      const available = typeof props.inputActions?.setDraft === 'function';
      const insert = react.useCallback((text) => {
        if (!available) return;
        // `setDraft` REPLACES the whole draft, so the append happens here.
        props.inputActions.setDraft(appendDraft(draft, text));
        setInserted(text);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setInserted(null), 1400);
      }, [available, draft, props.inputActions]);
      return { insert, inserted, available, hint: t('action.insertHint') };
    }

    /** One "加入输入框" button. */
    function InsertButton({ face, text, t, title }) {
      const done = face.inserted === text;
      return h('button', {
        type: 'button',
        className: 'dsh-feishu-btn',
        'data-done': done ? 'true' : 'false',
        title: face.available ? `${face.hint}\n${text}` : t('action.insertUnavailable'),
        disabled: !face.available,
        onClick: () => face.insert(text),
      }, done ? t('action.inserted') : t('action.insert'));
    }

    /**
     * The Feishu / Lark mark, in the product's own colours.
     *
     * The artwork is the 48×48 transparent logo the user supplied, embedded as a
     * data URI: no request at render time, no dependency, and nothing redrawn by
     * hand that could misrepresent the brand mark. It stays in full colour rather
     * than becoming a `currentColor` glyph — the shell's monochrome rail is the
     * shell's convention, and the mark people recognise is this one.
     *
     * Split across lines only so the bundle stays readable; it is one string.
     */
    const FEISHU_MARK_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAE3klEQVR4AexYS2wbVRQ9z5PE0CZ08lEooRRHoCBogpyGBVCjxhKqGsSigQWwoXiDxKrOEjZ2WCPZWSAUVyJG6j5FXVRl4whYIEGxJQpbe0GFuogwArEgsR/3TDJu6o7t+ZFQKdacmXm/e8+59703L4ngAf8dCjjoBB5m4DADASPgbgqV1038dH0+NNz6Kh6Qd2u4OwH9R2MwImuCUiiI6DJ+uVFF+XqsxcTnizsB0+cqUM0koDd8+nEaFkM0su7U4KXOnQBafHahhufOJ6GbyyyGhDh+vpENYsu9ANvLqYVsqCIUMgiwJrwLoBCKaDZTfA0FEeT82vEngN6mF4poNJPQqs5iMOidHc6HEf8C6GxmYQMa4YgwjAxNekUwAfTGHUo3lvgaDJIFH2shuACy5nRqhiBC6Qs05wXhCKDH6dfygXcnhYs05QUtAXNpfSGe1sG+jNbuhC+8ENjbV/3djJlvrl0aOVNYG0sUyqOvrFZHEwUt+N0qJwqlkcRq1kxcnrfHtQRoIG4ApcAitgbSYrwmcH1FNrcxeGWzPvzRbRh3tvJK4T3ygVZ2QE2rDMwrqIwBXRo9U6iaL34WawnAzi8WWMRssm4dO1xurw9f+wPDH95G9Ou/TMnADgs3d4Uv6999UGsXwKHBRfDYobe7HjkYdfPj33DkWp0+PUFr1Da/fZ+ZhpMAGqOI8gtp3ZprAKs9gIsa2vHwR/LHPrkD49d/PBi827XZaCTtUicBbOe8K51O6wwLvqB0Cm1TySbPpy+bGkVOHXtsNwFWHwVkJRM5q+D11jaVSJqR59OrKbt/o9G4Z2r2FMCBGkjLNlv1tUNZUwk1kg5KHm3RJzdXAthRwHVRlSllLR4pu74GvvlzKTB58dYefanquIjZ5ggF5GRKld1mw3z50/jQlc0cM+Bo0G2lQ/Q51EsG2N+CTCl+9JiNTDchI4nCJSPSX8LdD5I13s/NKfq040sABxKSjSw/fHNL+iLLNsz5NXM0sbou7XmpMwXBrg7Rp9FAAmhAEIM44CKnkJHE5YyxvVUFlOeTJRx+yojWO0Wf3cMQQDuEJeSJmbeyg6NTZt/AIOsCIWIM4PhTr67s3ffbDYYpwLLdFx3C2ORZnHj+HYzFzuKhoceseq83BmB86nzl1uePd/2vRegC9hIdHJvC8Wdex4mZt12LYdTNiTlMnHqj1n/00cW99pze/1MBtkNmxRZzMv4uxp8+h0fGp63sMENHzCetspU5EXts4nRdG9HFSl71PJbviwBbCJ+RvihIeOTkS1Z2mCEKYlnWDtiugJSQr7B/L0R6ddjPdvm+8Gy9eDOvrrr1+78RIORrTSDphTxFtgTI4KJUMALy2PdrQ/wnK3lV8eq5JaAiC6YBzDISXo347S++6gpYkqiTfM8F6+SnJYCNFPFjXk2K4ZTAl0Ha6QWxTeLLEvXJH/KKx41eQzq23yPA7iUiigJLiNRtCEK52ohnJWCBp6yjAJutiCgyvTK1JqHAvwM8ixHSzOSKkgUq9oYl4qEQx+6vq4DdPpBI1W7m1ArFCJQMmpW2RSG3TMg7NwBihWUt+zgJi/BhIT0pY9JC3LN4sdvzEi49+9zX4XvZLYTUVSGXJeQ9tYs0y4IiCYvwwFPkPudtFb4EtNk40OKhgAMNvzh/4DPwLwAAAP//dLFjdgAAAAZJREFUAwAi3tBw6nOgwgAAAABJRU5ErkJggg==';
    /**
     * @param {{ size?: number, className?: string }} props - the framework's `IconProps`.
     * @returns {any} the mark element.
     */
    function FeishuIcon({ size = 16, className }) {
      return h('img', {
        className: className === undefined || className === null || className.length === 0
          ? 'dsh-feishu-mark'
          : `dsh-feishu-mark ${className}`,
        src: FEISHU_MARK_SRC,
        width: size,
        height: size,
        // The mark is decoration in every seat it appears in: the row and the
        // guide capsule both carry their own text.
        alt: '',
        'aria-hidden': 'true',
        draggable: 'false',
      });
    }

    /**
     * The left sidebar's foot entry: the plugin's way in on every screen.
     *
     * It sits in the same strip as Settings, which is why it copies that row's
     * geometry, and it is the one seat whose click this plugin owns — which
     * matters. A rail *panel* row would be a better address, but selecting one
     * swaps the centre column, and the right Sidebar's session surface only
     * exists while the Conversation is selected: by the time such a page could
     * open the tab, there is no session left to open it in. So the click opens
     * the tab first, and only falls back to the page when there is no session to
     * open beside.
     *
     * @param {{ wide?: boolean, t: Function, sidebarRight: any, layout: any }} props - the seat's owner share plus the injected faces.
     * @returns {any} the entry element.
     */
    function SidebarAction({ wide, t, sidebarRight, layout }) {
      const open = react.useCallback(() => {
        try {
          sidebarRight.openTab(TAB_KIND);
          return;
        } catch {
          // No session surface: nothing to open beside. Show the page instead,
          // which needs no session for anything except insertion.
          layout.selectPanel(MAIN_PANEL_ID);
        }
      }, [sidebarRight, layout]);
      return h('button', {
        type: 'button',
        className: 'dsh-feishu-footBtn',
        'data-wide': wide === true ? 'true' : 'false',
        title: t('tab.guide'),
        'aria-label': t('tab.title'),
        onClick: open,
      },
        h(FeishuIcon, { size: 16 }),
        wide === true ? h('span', { className: 'dsh-feishu-footLabel' }, t('tab.title')) : null,
      );
    }

    /**
     * A muted note block.
     *
     * The children are read from `props.children` and spread rather than
     * forwarded as one array. React would flatten a nested array anyway, but it
     * also *omits* `children` from `props` when the only child is a bare string
     * (``h(Note, props, 'text')`` yields `props` without a `children` key), so a
     * component that only reads `props.children` draws an empty box for exactly
     * the one-line notes this panel is full of.
     */
    function Note(props) {
      const children = props.children;
      return h('div', { className: 'dsh-feishu-note', 'data-tone': props.tone ?? 'info' }, ...(Array.isArray(children) ? children : [children]));
    }

    /**
     * The panel's transient answer to "did that click do anything?".
     *
     * Completing a task writes to Feishu and then removes the row, which on its
     * own looks like the row simply vanished; this is the part that says it
     * worked, and it is also where a failure lands without taking over the whole
     * panel. `role="status"` so a screen reader announces it.
     */
    function Toast({ toast, t, onDismiss }) {
      if (toast === null) return null;
      const success = toast.tone !== 'error';
      return h('div', {
        className: 'dsh-feishu-toast',
        'data-tone': success ? 'success' : 'error',
        role: 'status',
        'aria-live': 'polite',
      },
        h('span', { className: 'dsh-feishu-toastTick', 'aria-hidden': 'true' }, success ? '✓' : '!'),
        h('div', { className: 'dsh-feishu-toastBody' },
          h('div', { className: 'dsh-feishu-toastText' }, toast.text),
          toast.detail === undefined || toast.detail === null || String(toast.detail).length === 0
            ? null
            : h('div', { className: 'dsh-feishu-toastDetail' }, toast.detail),
        ),
        onDismiss === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'dsh-feishu-toastClose',
            title: t('toast.dismiss'),
            'aria-label': t('toast.dismiss'),
            onClick: onDismiss,
          }, '×'),
      );
    }

    /**
     * Copy-to-clipboard button for the configuration command.
     *
     * The clipboard API is unavailable outside a secure context and can be
     * denied, so a failure leaves the label alone rather than claiming a copy
     * that did not happen — the command stays on screen and selectable.
     */
    function CopyButton({ text, t }) {
      const [copied, setCopied] = react.useState(false);
      const timer = react.useRef(null);
      react.useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current);
      }, []);
      const onCopy = react.useCallback(() => {
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') return;
        void clipboard.writeText(text).then(() => {
          setCopied(true);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1400);
        }).catch(() => {});
      }, [text]);
      return h('button', {
        type: 'button',
        className: 'dsh-feishu-btn',
        'data-done': copied ? 'true' : 'false',
        onClick: onCopy,
      }, copied ? t('hint.copied') : t('hint.copy'));
    }

    // ── tasks view ──────────────────────────────────────────────────────────
    /**
     * Task list with per-row actions.
     *
     * `pending`/`justDone`/`removed` are the completion effect's three phases,
     * all owned by the panel: the row being written to Feishu, the row that just
     * landed (green, tick, collapsing), and the rows a successful write has
     * already taken out of the list while the refresh catches up.
     */
    function TasksView({ state, t, face, onComplete, busy, pending, justDone, removed }) {
      const all = Array.isArray(state.tasks) ? state.tasks : [];
      const tasks = all.filter((task) => removed?.[task.id] !== true);
      const now = Date.now();
      return h('div', null,
        state.tasksNotice === undefined || state.tasksNotice === null
          ? null
          : h(Note, null, state.tasksNotice),
        state.tasksSource === undefined
          ? null
          : h('div', { className: 'dsh-feishu-kv' }, state.tasksSource === 'my_tasks' ? t('label.source.myTasks') : t('label.source.tasklists')),
        // Three different situations produce an empty list, and telling them
        // apart is the difference between "you are done" and "this is broken".
        tasks.length === 0 && state.tasksError !== undefined
          ? h(Note, { tone: 'error' }, `${t('error.tasksFailed')}：${state.tasksError}`)
          : tasks.length === 0 && state.tasksLoaded !== true
            ? h('div', { className: 'dsh-feishu-empty' }, t('loading'))
            : tasks.length === 0
              ? h('div', { className: 'dsh-feishu-empty' }, t('empty.tasks'))
              : tasks.map((task) => {
            const overdue = typeof task.due === 'number' && task.due < now && task.completed !== true;
            const text = taskToText(task, t);
            const rowState = pending === task.id ? 'pending' : justDone === task.id ? 'done' : 'idle';
            return h('div', { className: 'dsh-feishu-row', key: task.id, 'data-state': rowState },
              h('div', { className: 'dsh-feishu-row-main' },
                h('div', { className: 'dsh-feishu-title', 'data-done': task.completed === true ? 'true' : 'false' }, task.title),
                h('div', { className: 'dsh-feishu-meta' },
                  typeof task.due === 'number'
                    ? h('span', { className: 'dsh-feishu-chip', 'data-tone': overdue ? 'warn' : 'none' }, `${overdue ? t('label.overdue') : t('label.due')} ${formatDue(task.due, task.dueAllDay)}`)
                    : null,
                  typeof task.tasklistName === 'string' && task.tasklistName.length > 0
                    ? h('span', { className: 'dsh-feishu-chip' }, `${t('label.list')}: ${task.tasklistName}`)
                    : null,
                ),
              ),
              h(InsertButton, { face, text, t }),
              task.completed === true
                ? null
                : h('button', {
                  type: 'button',
                  // The title says it out loud: this button writes to Feishu,
                  // it does not hide a row in this panel.
                  className: 'dsh-feishu-btn dsh-feishu-complete',
                  'data-state': rowState === 'idle' ? 'idle' : rowState,
                  disabled: busy,
                  title: t('action.complete.hint'),
                  onClick: () => onComplete(task),
                },
                rowState === 'idle'
                  ? t('action.complete')
                  : rowState === 'pending'
                    ? [h('span', { className: 'dsh-feishu-spin', key: 'spin', 'aria-hidden': 'true' }), t('action.completing')]
                    : `✓ ${t('action.completed')}`),
            );
          }),
      );
    }

    // ── chat view ───────────────────────────────────────────────────────────
    /**
     * A sender's avatar.
     *
     * Real avatar images are the exception here: the message rows carry only an
     * open id, and reading anyone's avatar needs a contacts permission this
     * plugin deliberately does not ask for. So the normal case is a colored
     * initial circle — stable per sender, legible at 28px, and the thing every
     * chat app falls back to anyway. The authorized user's own avatar *is*
     * available (their profile comes back from the token exchange), so it is used
     * when present, with the circle as the fallback if it fails to load.
     *
     * A sender with no resolved name gets a neutral grey circle instead: coloring
     * an id hash as if it identified a person is the same invention as printing
     * the id as a name.
     *
     * @param {{ name?: string, id?: string, url?: string, size?: number, unknown?: boolean }} props - identity and geometry.
     * @returns {any} the avatar element.
     */
    function Avatar({ name, id, url, size = 28, unknown = false }) {
      const [failed, setFailed] = react.useState(false);
      // An unknown sender shows a question mark, not the placeholder's own
      // characters: two unknown people must not look like two named ones.
      const label = unknown ? '?' : initials(name);
      if (typeof url === 'string' && url.length > 0 && !failed) {
        return h('img', {
          className: 'dsh-feishu-avatar',
          src: url,
          width: size,
          height: size,
          alt: '',
          'aria-hidden': 'true',
          draggable: 'false',
          onError: () => setFailed(true),
        });
      }
      return h('span', {
        className: unknown ? 'dsh-feishu-avatar dsh-feishu-avatarText dsh-feishu-avatarUnknown' : 'dsh-feishu-avatar dsh-feishu-avatarText',
        style: unknown ? undefined : { '--ff-avatar-hue': String(avatarHue(id === undefined || id.length === 0 ? name : id)) },
        title: name,
        'aria-hidden': 'true',
      }, label);
    }

    /** A centred day separator between message groups. */
    function DaySeparator({ label }) {
      return h('div', { className: 'dsh-feishu-daySep' }, h('span', null, label));
    }

    /**
     * Split one line into plain text, mention and link runs.
     *
     * Mentions are matched exactly against the message's own mention list rather
     * than by a pattern: an `@` that happens to appear in prose (an email, a
     * handle nobody was mentioned with) must not light up as a mention.
     *
     * @param {string} line - already-substituted line text.
     * @param {Array<{ name: string }>} mentions - the message's mentions.
     * @returns {Array<{ type: 'text' | 'mention' | 'link', text: string }>} runs in order.
     */
    function splitMessageLine(line, mentions) {
      const tokens = mentions.map((mention) => `@${mention.name}`).filter((token) => token.length > 1);
      const runs = [];
      let rest = String(line ?? '');
      let guard = 0;
      while (rest.length > 0 && guard < 60) {
        guard += 1;
        let at = -1;
        let hit = '';
        let kind = 'text';
        for (const token of tokens) {
          const index = rest.indexOf(token);
          if (index !== -1 && (at === -1 || index < at)) {
            at = index;
            hit = token;
            kind = 'mention';
          }
        }
        const link = /https?:\/\/[^\s<>()]+/.exec(rest);
        if (link !== null && (at === -1 || link.index < at)) {
          at = link.index;
          hit = link[0];
          kind = 'link';
        }
        if (at === -1) break;
        if (at > 0) runs.push({ type: 'text', text: rest.slice(0, at) });
        runs.push({ type: kind, text: hit });
        rest = rest.slice(at + hit.length);
      }
      if (rest.length > 0) runs.push({ type: 'text', text: rest });
      return runs;
    }

    /** One message line: mentions highlighted, links clickable. */
    function MessageLine({ line, mentions, t }) {
      const runs = splitMessageLine(line, mentions);
      if (runs.length === 1 && runs[0].type === 'text') return h('div', { className: 'dsh-feishu-line' }, runs[0].text);
      return h('div', { className: 'dsh-feishu-line' },
        runs.map((run, index) => {
          if (run.type === 'mention') return h('span', { className: 'dsh-feishu-mention', key: `r-${index}` }, run.text);
          if (run.type === 'link') {
            return h('a', {
              className: 'dsh-feishu-link',
              key: `r-${index}`,
              href: run.text,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, run.text);
          }
          return run.text;
        }),
      );
    }

    /** An image bubble body that degrades to a label instead of a broken icon. */
    function MessageImage({ url, t }) {
      const [failed, setFailed] = react.useState(false);
      if (failed) return h('div', { className: 'dsh-feishu-mediaFailed' }, t('msg.imageFailed'));
      return h('img', {
        className: 'dsh-feishu-mediaImage',
        src: url,
        alt: t('msg.image'),
        loading: 'lazy',
        onError: () => setFailed(true),
      });
    }

    /** `1:05` / `12s` for an audio or video length. */
    function formatDuration(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return minutes === 0 ? `${seconds}s` : `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    /**
     * The body of one bubble, by message kind.
     *
     * Every kind has a text form as well (`lines`), so an unknown or
     * unrenderable message still says something instead of leaving a hole.
     */
    function MessageBody({ message, t }) {
      const lines = Array.isArray(message.lines) && message.lines.length > 0 ? message.lines : [message.text];
      if (message.kind === 'image') {
        const url = mediaUrl(message, 'image');
        if (url === undefined) return h('div', { className: 'dsh-feishu-line' }, lines.join(' '));
        return h('a', { className: 'dsh-feishu-media', href: url, target: '_blank', rel: 'noreferrer noopener' },
          h(MessageImage, { url, t }));
      }
      if (message.kind === 'file' || message.kind === 'audio' || message.kind === 'video') {
        const url = mediaUrl(message, 'file');
        const name = typeof message.media?.fileName === 'string' && message.media.fileName.length > 0
          ? message.media.fileName
          : lines.join(' ');
        const duration = typeof message.media?.durationMs === 'number' ? formatDuration(message.media.durationMs) : undefined;
        return h('div', { className: 'dsh-feishu-fileCard' },
          message.kind === 'audio' && url !== undefined ? h('audio', { className: 'dsh-feishu-audio', src: url, controls: true, preload: 'metadata' }) : null,
          message.kind === 'video' && url !== undefined ? h('video', { className: 'dsh-feishu-video', src: url, controls: true, preload: 'metadata' }) : null,
          h('div', { className: 'dsh-feishu-fileRow' },
            h('span', { className: 'dsh-feishu-fileName', title: name }, name),
            duration === undefined ? null : h('span', { className: 'dsh-feishu-fileMeta' }, duration),
          ),
          url === undefined
            ? null
            : h('a', { className: 'dsh-feishu-fileLink', href: url, target: '_blank', rel: 'noreferrer noopener' }, t('msg.download')),
        );
      }
      return lines.map((line, index) => h(MessageLine, { key: `l-${index}`, line, mentions: message.mentions ?? [], t }));
    }

    /** The quoted parent of a reply, when the parent is inside the window. */
    function MessageQuote({ message, t }) {
      const text = message.text.length > 0 ? message.text.slice(0, 80) : t('msg.recalledShort');
      return h('div', { className: 'dsh-feishu-quote' },
        h('span', { className: 'dsh-feishu-quoteWho' }, senderLabel(message, t)),
        h('span', { className: 'dsh-feishu-quoteText' }, text),
      );
    }

    /**
     * One message row: avatar, optional name/time header, quote, bubble, and the
     * row's action beside it.
     *
     * `grouped` marks a message that continues the previous speaker, which is
     * what lets one avatar and one name cover a burst of lines instead of
     * repeating them.
     */
    function MessageBubble({ message, self, t, face, grouped, quoted, missingQuote }) {
      const mine = typeof self?.id === 'string' && self.id.length > 0 && message.senderId === self.id;
      const unknown = senderUnknown(message);
      const clock = message.at > 0 ? formatClock(message.at) : '';
      // The authorized user's own name comes from the token exchange; when a chat
      // lookup does not return it, "我" is still true (the id matched), unlike an
      // arbitrary sender, so it is only replaced when the row is really unknown.
      const name = mine ? (typeof self.name === 'string' && self.name.length > 0 ? self.name : t('msg.me')) : senderLabel(message, t);
      return h('div', { className: 'dsh-feishu-msg', 'data-self': mine ? 'true' : 'false' },
        h('div', { className: 'dsh-feishu-msgAvatarSlot' },
          grouped ? null : h(Avatar, {
            name,
            id: message.senderId,
            url: mine ? self.avatar : undefined,
            unknown: !mine && unknown,
          })),
        h('div', { className: 'dsh-feishu-msgMain' },
          grouped ? null : h('div', { className: 'dsh-feishu-msgHead' },
            h('span', {
              className: 'dsh-feishu-msgSender',
              'data-unknown': !mine && unknown ? 'true' : undefined,
              title: unknown && !mine ? message.senderId : undefined,
            }, mine ? t('msg.me') : name),
            message.senderType === 'app' ? h('span', { className: 'dsh-feishu-chip' }, t('msg.app')) : null,
            h('span', { className: 'dsh-feishu-msgTime' }, clock),
          ),
          quoted === undefined
            ? missingQuote === true ? h('div', { className: 'dsh-feishu-quoteMissing' }, t('msg.quoteMissing')) : null
            : h(MessageQuote, { message: quoted, t }),
          h('div', { className: 'dsh-feishu-bubble', 'data-kind': message.kind },
            h(MessageBody, { message, t })),
        ),
        // Beside the row, not under the bubble: stacked below, every message
        // reserved a hidden button's height, which is what put a screen between
        // consecutive messages in a narrow panel.
        h('div', { className: 'dsh-feishu-msgActions' },
          h(InsertButton, { face, text: messageToText(message, t), t })),
      );
    }

    /** A recalled message, as the centred system line every chat app shows. */
    function RecalledLine({ message, t }) {
      return h('div', { className: 'dsh-feishu-recalled' },
        `${senderLabel(message, t)} ${t('msg.recalled')}`);
    }

    /**
     * The whole conversation, drawn like a chat app.
     *
     * `max` bounds the DOM: the host may hand back up to 2000 messages, and
     * rendering all of them would make the panel crawl. The newest ones win,
     * because that is the end of a conversation anyone reads.
     *
     * @param {{ bundle: any, self: any, t: Function, face: any, max?: number }} props - transcript bundle and insertion face.
     * @returns {any} the message list.
     */
    function MessageList({ bundle, self, t, face, max = 300 }) {
      const all = Array.isArray(bundle?.messages) ? bundle.messages : [];
      const shown = all.length > max ? all.slice(all.length - max) : all;
      const end = react.useRef(null);
      // A chat opens at the newest message, not at the top of the history.
      react.useEffect(() => {
        const node = end.current;
        if (node !== null && node !== undefined && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest' });
        }
      }, [bundle?.fetchedAt]);
      if (all.length === 0) {
        return h('div', { className: 'dsh-feishu-empty' }, t('empty.messages'));
      }
      const byId = new Map(all.map((message) => [message.id, message]));
      const rows = [];
      let lastDay = '';
      let previous = null;
      for (const message of shown) {
        const day = dayKey(message.at);
        if (day !== lastDay) {
          rows.push(h(DaySeparator, { key: `day-${day}-${message.id}`, label: formatDayLabel(message.at, t) }));
          lastDay = day;
        }
        const grouped = previous !== null
          && previous.kind !== 'recalled'
          && message.kind !== 'recalled'
          && previous.senderId === message.senderId
          // A group never spans midnight: the day separator in between would
          // otherwise sit inside one speaker's run.
          && dayKey(previous.at) === day
          && message.at - previous.at < 300_000;
        const quoted = typeof message.parentId === 'string' ? byId.get(message.parentId) : undefined;
        if (message.kind === 'recalled') {
          rows.push(h(RecalledLine, { key: message.id, message, t }));
        } else {
          rows.push(h(MessageBubble, {
            key: message.id,
            message,
            self,
            t,
            face,
            grouped,
            quoted,
            missingQuote: typeof message.parentId === 'string' && quoted === undefined,
          }));
        }
        previous = message;
      }
      return h('div', { className: 'dsh-feishu-messages' },
        all.length > shown.length
          ? h('div', { className: 'dsh-feishu-msgNote' },
            t('msg.capped').replace('{shown}', String(shown.length)).replace('{total}', String(all.length)))
          : null,
        rows,
        h('div', { className: 'dsh-feishu-msgEnd', ref: end }),
      );
    }

    // ── chats view ──────────────────────────────────────────────────────────
    /**
     * Chat picker, the two secondary views, and the summarize result.
     *
     * The selection and the sub-view live in the panel rather than here: the
     * panel's own refresh control has to be able to reload whatever this tab is
     * showing, and two owners of one selection is how a refresh silently
     * reloads the wrong thing.
     */
    function ChatsView({ chats, t, face, summary, transcript, self, busy, chatId, hours, sub, onPick, onRange, onSub, onSummarize, onFetch, onLogin, auth }) {
      const [callbackUrl, setCallbackUrl] = react.useState('');
      const selected = chats.find((chat) => chat.id === chatId);
      return h('div', null,
        h('div', { className: 'dsh-feishu-toolbar' },
          h('label', { className: 'dsh-feishu-inline' },
            h('span', { className: 'dsh-feishu-kv' }, t('label.chat')),
            h('select', {
              className: 'dsh-feishu-select',
              value: chatId,
              onChange: (event) => onPick(event.target.value),
            }, chats.length === 0
              ? h('option', { value: '' }, t('empty.chats'))
              : chats.map((chat) => h('option', { key: chat.id, value: chat.id }, chat.name))),
          ),
          h('label', { className: 'dsh-feishu-inline', style: { width: 'auto' } },
            h('span', { className: 'dsh-feishu-kv' }, t('label.range')),
            h('select', {
              className: 'dsh-feishu-select',
              value: String(hours),
              onChange: (event) => onRange(Number(event.target.value)),
            },
            h('option', { value: '24' }, t('range.24h')),
            h('option', { value: '72' }, t('range.3d')),
            h('option', { value: '168' }, t('range.7d')),
            h('option', { value: '720' }, t('range.30d'))),
          ),
          h('button', {
            type: 'button',
            className: 'dsh-feishu-btn',
            disabled: busy || chatId === '',
            onClick: () => onFetch({ chatId, hours }),
          }, t('action.fetchMessages')),
          h('button', {
            type: 'button',
            className: 'dsh-feishu-btn',
            'data-variant': 'primary',
            disabled: busy || chatId === '',
            onClick: () => onSummarize({ chatId, hours }),
          }, t('action.summarize')),
        ),
        // The authorization block stays visible whether or not a login is
        // pending. The redirect lands on another service's callback (one Feishu
        // app has one redirect-URL list), so the user has to carry the code
        // back by hand — and that box must still be here when they return with
        // it, not only while the panel still thinks nobody has signed in.
        h('details', { className: 'dsh-feishu-details', open: auth !== undefined && auth.showLogin === true },
          h('summary', { className: 'dsh-feishu-summaryLine' },
            auth !== undefined && auth.userLoggedIn === true
              ? t('auth.loggedIn').replace('{name}', auth.userName === undefined || auth.userName.length === 0 ? '—' : auth.userName)
              : t('auth.title')),
          h('div', { className: 'dsh-feishu-detailsBody' },
            h(Note, null, t('hint.login1')),
            h('div', { className: 'dsh-feishu-toolbar' },
              h('button', { type: 'button', className: 'dsh-feishu-btn', disabled: busy, onClick: onLogin }, t('action.openAuth')),
            ),
            h(Note, null, t('hint.login2')),
            h('div', { className: 'dsh-feishu-toolbar' },
              h('input', {
                className: 'dsh-feishu-input',
                placeholder: 'https://agent-api.star-mission.com/webhooks/feishu/oauth/callback?code=…',
                value: callbackUrl,
                onChange: (event) => setCallbackUrl(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'dsh-feishu-btn',
                'data-variant': 'primary',
                disabled: busy || callbackUrl.trim().length === 0,
                onClick: () => {
                  auth.onComplete(callbackUrl);
                  setCallbackUrl('');
                },
              }, t('action.submitCallback')),
            ),
          ),
        ),
        // Two views of the same group: what was said, and what the model made of
        // it. The transcript is what a person actually reads, so it is the
        // default; the summary is one click away and one click back.
        h('div', { className: 'dsh-feishu-tabs dsh-feishu-subtabs' },
          h('button', {
            type: 'button', className: 'dsh-feishu-tab', 'data-active': sub === 'messages' ? 'true' : 'false',
            onClick: () => onSub('messages'),
          }, t('view.messages')),
          h('button', {
            type: 'button', className: 'dsh-feishu-tab', 'data-active': sub === 'summary' ? 'true' : 'false',
            onClick: () => onSub('summary'),
          }, t('view.summary')),
        ),
        sub === 'messages'
          ? h(ChatThread, { transcript, selected, t, face, self, busy })
          : summary === null
            ? h('div', { className: 'dsh-feishu-empty' }, t('empty.summary'))
            : h('div', null,
              h('div', { className: 'dsh-feishu-kv' },
                `${summary.chatName} · ${summary.messageCount} ${t('label.messages')}`
                + (summary.truncated ? ` · ${t('label.truncated')}` : '')
                + (typeof summary.model === 'string' ? ` · ${t('label.model')}: ${summary.model}` : ''),
              ),
              summary.warning === undefined || summary.warning === null ? null : h(Note, { tone: 'error' }, summary.warning),
              h('div', { className: 'dsh-feishu-section' }, t('label.summary')),
              h('div', { className: 'dsh-feishu-summary' }, summary.summary),
              summary.keyPoints.length === 0 ? null : h('div', null,
                h('div', { className: 'dsh-feishu-section' }, t('label.keyPoints')),
                h('ul', { className: 'dsh-feishu-list' }, summary.keyPoints.map((point, index) => h('li', { key: `kp-${index}` }, point))),
              ),
              summary.actionItems.length === 0 ? null : h('div', null,
                h('div', { className: 'dsh-feishu-section' }, t('label.actionItems')),
                summary.actionItems.map((item, index) => {
                  const text = actionToText(item);
                  return h('div', { className: 'dsh-feishu-row', key: `ai-${index}` },
                    h('div', { className: 'dsh-feishu-row-main' },
                      h('div', { className: 'dsh-feishu-title' }, item.title),
                      h('div', { className: 'dsh-feishu-meta' },
                        item.owner.length === 0 ? null : h('span', { className: 'dsh-feishu-chip' }, `${t('label.owner')}: ${item.owner}`),
                        item.due.length === 0 ? null : h('span', { className: 'dsh-feishu-chip' }, `${t('label.due')}: ${item.due}`),
                        h('span', { className: 'dsh-feishu-chip', 'data-tone': item.priority === 'high' ? 'high' : 'none' }, item.priority),
                      ),
                    ),
                    h(InsertButton, { face, text, t }),
                  );
                }),
              ),
            ),
      );
    }

    /**
     * The transcript with its own header: which group, how much of it, and the
     * two ways a read can be incomplete (a capped list, names that could not be
     * resolved) stated where the user can see them.
     */
    function ChatThread({ transcript, selected, t, face, self, busy }) {
      if (transcript === null || transcript === undefined) {
        return h('div', { className: 'dsh-feishu-empty' }, busy ? t('loading') : t('empty.thread'));
      }
      const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
      const chat = transcript.chat ?? selected;
      const head = h('div', { className: 'dsh-feishu-threadHead' },
        chat === undefined
          ? null
          : h('span', { className: 'dsh-feishu-threadAvatar' },
            h(Avatar, { name: chat.name, id: chat.id, url: chat.avatar, size: 36 })),
        h('div', { className: 'dsh-feishu-threadMeta' },
          h('div', { className: 'dsh-feishu-threadName' }, chat === undefined ? transcript.chatName : chat.name),
          h('div', { className: 'dsh-feishu-kv' },
            `${messages.length} ${t('label.messages')}`
            + (transcript.truncated ? ` · ${t('label.truncated')}` : '')
            + (transcript.memberLookup !== undefined && transcript.memberLookup.ok === false ? ` · ${t('msg.namesFailed')}` : '')),
        ),
      );
      // Only rows that claimed a sender and could not be named count: a message
      // with no sender identity at all was never attributable, so it is not a
      // name the lookup failed to resolve.
      const unresolved = messages.filter((message) => senderUnknown(message) && String(message.senderId ?? '').length > 0).length;
      return h('div', null,
        head,
        transcript.memberLookup !== undefined && transcript.memberLookup.ok === false
          ? h(Note, { tone: 'error' }, `${t('msg.namesFailedHint')}：${transcript.memberLookup.error ?? ''}`)
          : unresolved > 0
            ? h(Note, { tone: 'warn' }, `${t('msg.unknownSenderHint')}（${unresolved}）`)
            : null,
        h(MessageList, { bundle: transcript, self, t, face }),
      );
    }

    // ── panel ───────────────────────────────────────────────────────────────
    /**
     * The panel itself, independent of which seat renders it.
     *
     * Two seats do: the right Sidebar's tab body (session-scoped, so it builds
     * its own insert face from the Session's composer) and the left rail's page
     * (root-scoped, which is the only seat that exists on the home screen). The
     * insert face is passed in because only a session seat can have one.
     *
     * @param {{ t: Function, face: any, notice?: string | null }} props - copy, insertion face, and an optional standing note.
     */
    function PanelBody({ t, face, notice }) {
      const [view, setView] = react.useState('tasks');
      const [state, setState] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [summary, setSummary] = react.useState(null);
      const [toast, setToast] = react.useState(null);
      // The chats tab's own state lives up here: its selection decides what the
      // panel's refresh control has to reload, and the summary result has to be
      // able to switch its sub-view.
      const [chatId, setChatId] = react.useState('');
      const [hours, setHours] = react.useState(24);
      const [chatSub, setChatSub] = react.useState('messages');
      const [transcript, setTranscript] = react.useState(null);
      // The completion effect's clock: which row is being written, which one just
      // landed, and which rows a successful write has already taken out of the
      // list. See `TasksView` for how they render.
      const [pending, setPending] = react.useState(null);
      const [justDone, setJustDone] = react.useState(null);
      const [removed, setRemoved] = react.useState({});
      // How long the finished row is left on screen before the list is made
      // authoritative again: long enough for the green state and the tick to
      // register, short enough not to feel like lag.
      const DONE_HOLD_MS = 1000;

      react.useEffect(() => {
        if (toast === null) return undefined;
        const timer = setTimeout(() => setToast(null), 4000);
        return () => clearTimeout(timer);
      }, [toast]);

      const reload = react.useCallback(async (force) => {
        setBusy(true);
        setError(null);
        try {
          const next = await callApi(force === true ? '/api/tasks/refresh' : '/api/state', force === true ? { source: 'tasks' } : undefined);
          if (force === true && next !== undefined && next.items !== undefined) {
            // `tasks/refresh` returns the task bundle alone; keep the rest of the
            // last state so the header does not flicker. The error has to ride
            // along: a failed refresh comes back as an empty list, and patching
            // only `tasks` would print "no open tasks" over a broken read.
            setState((previous) => ({
              ...(previous ?? {}),
              tasks: next.items,
              tasksSource: next.source,
              tasksNotice: next.notice,
              tasksError: next.error,
              tasksLoaded: true,
            }));
          } else {
            setState(next);
          }
        } catch (failure) {
          setError(failure);
        } finally {
          setBusy(false);
        }
      }, []);

      const loadChats = react.useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
          await callApi('/api/chats/refresh', {});
          // Re-read rather than patching the response in: `/api/state` is the
          // one shape the panel renders, so a refresh cannot drift from it.
          setState(await callApi('/api/state'));
        } catch (failure) {
          setError(failure);
        } finally {
          setBusy(false);
        }
      }, []);

      react.useEffect(() => { void reload(false); }, [reload]);

      // The group list is a live server-side read, so it is fetched only when
      // asked for — on first open, and from the refresh control. Without this
      // the panel reads an empty cache forever and claims the bot is in no
      // groups, which is the one wrong answer a user cannot diagnose.
      const chatsRequested = react.useRef(false);
      react.useEffect(() => {
        if (state === null || state.configured !== true) return;
        const loaded = Array.isArray(state.chats) && state.chats.length > 0;
        // The ref makes this fire once, so a bot that genuinely belongs to no
        // group is not refetched on every state change.
        if (loaded || chatsRequested.current) return;
        chatsRequested.current = true;
        void loadChats();
      }, [state === null ? null : state.configured, state === null ? null : (state.chats ?? []).length]);

      const run = react.useCallback(async (action) => {
        setBusy(true);
        setError(null);
        try {
          await action();
        } catch (failure) {
          setError(failure);
        } finally {
          setBusy(false);
        }
      }, []);

      /**
       * Read the selected group's messages.
       *
       * Kept separate from `run` so a summary can refresh the thread without
       * taking over the busy state mid-summarize.
       */
      const loadTranscript = react.useCallback((options) => run(async () => {
        setTranscript(await callApi('/api/messages', options));
      }), [run]);

      // A chat app shows the conversation without being asked. The ref keys the
      // last request, so switching back to a group already loaded does not
      // refetch, while changing group or range does.
      const transcriptRequested = react.useRef('');
      react.useEffect(() => {
        if (chatId === '') return;
        const key = `${chatId}|${hours}`;
        if (transcriptRequested.current === key) return;
        transcriptRequested.current = key;
        void loadTranscript({ chatId, hours });
      }, [chatId, hours, loadTranscript]);

      // First group wins until the user picks one, so the tab is never a blank
      // picker with nothing selected.
      react.useEffect(() => {
        if (chatId !== '') return;
        const chats = Array.isArray(state?.chats) ? state.chats : [];
        if (chats.length > 0) setChatId(chats[0].id);
      }, [state === null ? 0 : (state.chats ?? []).length, chatId]);

      const onComplete = react.useCallback((task) => {
        void run(async () => {
          setPending(task.id);
          try {
            await callApi('/api/tasks/complete', { id: task.id, completed: true });
          } catch (failure) {
            // Say it next to the row as well as in the panel's error line: the
            // click is about this one task, and the error line can be scrolled
            // away from it.
            setPending(null);
            setToast({ tone: 'error', text: t('toast.failed'), detail: failure.message });
            throw failure;
          }
          // The write landed. The row's green state, its tick and this toast are
          // the only feedback that the click changed something in Feishu — the
          // list then drops the row, which on its own looks like nothing
          // happened.
          setPending(null);
          setJustDone(task.id);
          setToast({ tone: 'success', text: t('toast.completed'), detail: task.title });
          await new Promise((resolve) => { setTimeout(resolve, DONE_HOLD_MS); });
          // Hide it locally as well: if the read below fails, the row must not
          // come back as if the write had not happened.
          setRemoved((previous) => ({ ...previous, [task.id]: true }));
          setJustDone(null);
          try {
            // A forced read, not `/api/state`: the write invalidated the server
            // cache, and a plain state read used to come back short. Forcing it
            // makes the refresh authoritative so the list matches Feishu.
            const next = await callApi('/api/tasks/refresh', {});
            setState((previous) => ({
              ...(previous ?? {}),
              tasks: next.items,
              tasksSource: next.source,
              tasksNotice: next.notice,
              tasksError: next.error,
              tasksLoaded: true,
            }));
            // The server list is authoritative now, so nothing needs hiding.
            setRemoved({});
          } catch {
            // The completion itself succeeded; a failed read afterwards must not
            // turn that into an error. The hidden row stays hidden and the next
            // load reconciles the list.
          }
        });
      }, [run, t]);

      const onSummarize = react.useCallback((options) => {
        void run(async () => {
          const data = await callApi('/api/summarize', { chatId: options.chatId, hours: options.hours });
          setSummary({ ...data.summary, ...data.transcript });
          // The response carries the same transcript bundle the read route
          // returns, so the thread behind the summary is exactly what was
          // summarized — and the summary is what the user asked for, so it is
          // what they get shown.
          if (data.transcript !== undefined && data.transcript !== null) setTranscript(data.transcript);
          setChatSub('summary');
        });
      }, [run]);

      /** Reload the thread for whatever the tab is showing, without touching busy. */
      const onFetch = react.useCallback((options) => {
        void loadTranscript({ chatId: options.chatId, hours: options.hours });
      }, [loadTranscript]);

      const onLogin = react.useCallback(() => {
        void run(async () => {
          const data = await callApi('/api/auth/url', {});
          window.open(data.url, '_blank', 'noopener,noreferrer');
        });
      }, [run]);

      const onCompleteAuth = react.useCallback((callbackUrl) => {
        void run(async () => {
          await callApi('/api/auth/complete', { callbackUrl });
          const next = await callApi('/api/state');
          setState(next);
        });
      }, [run]);

      const onLogout = react.useCallback(() => {
        void run(async () => {
          await callApi('/api/auth/logout', {});
          const next = await callApi('/api/state');
          setState(next);
        });
      }, [run]);

      const configured = state?.configured === true;
      const header = h('div', { className: 'dsh-feishu-tabs' },
        h('button', {
          type: 'button', className: 'dsh-feishu-tab', 'data-active': view === 'tasks' ? 'true' : 'false',
          onClick: () => setView('tasks'),
        }, t('view.tasks')),
        h('button', {
          type: 'button', className: 'dsh-feishu-tab', 'data-active': view === 'chats' ? 'true' : 'false',
          onClick: () => {
            setView('chats');
            // Opening the tab is a fresh request for the list; the one-shot
            // mount fetch may have run before the bot joined anything.
            if (!(Array.isArray(state?.chats) && state.chats.length > 0)) {
              chatsRequested.current = false;
              void loadChats();
            }
          },
        }, t('view.chats')),
      );

      const toolbar = h('div', { className: 'dsh-feishu-toolbar' },
        h('button', {
          type: 'button', className: 'dsh-feishu-btn', disabled: busy || !configured,
          // Refresh follows the visible tab: the two halves read different
          // Feishu endpoints, so one button that refreshed only tasks left the
          // group list permanently empty. On the chats tab it reloads both
          // halves of that tab — the group list and the open thread — because
          // "refresh" cannot mean "refresh the thing you are not looking at".
          onClick: () => {
            if (view !== 'chats') {
              void reload(true);
              return;
            }
            void run(async () => {
              await callApi('/api/chats/refresh', {});
              setState(await callApi('/api/state'));
              if (chatId !== '') setTranscript(await callApi('/api/messages', { chatId, hours }));
            });
          },
        }, busy ? t('loading') : t('action.refresh')),
        configured && state?.userLoggedIn === true
          ? h('button', { type: 'button', className: 'dsh-feishu-btn', disabled: busy, onClick: onLogout },
            state.userName === undefined || state.userName.length === 0 ? t('action.logout') : `${state.userName} · ${t('action.logout')}`)
          : null,
      );

      let body;
      if (configured !== true) {
        // The command and the YAML snippet come from the host, so the panel
        // never spells a configuration path the host would not honour.
        const command = typeof state?.configureCommand === 'string' ? state.configureCommand : '';
        const settingsPath = typeof state?.settingsPath === 'string' ? state.settingsPath : '$DSH_HOME/settings.yaml';
        const namespace = typeof state?.settingsNamespace === 'string' ? state.settingsNamespace : 'feishu-plugin';
        body = h('div', null,
          h(Note, null, t('hint.unconfigured')),
          command.length === 0 ? null : h('pre', { className: 'dsh-feishu-code' }, command),
          h('div', { className: 'dsh-feishu-toolbar' },
            command.length === 0 ? null : h(CopyButton, { text: command, t }),
          ),
          h(Note, null, t('hint.unconfiguredManual')),
          h('pre', { className: 'dsh-feishu-code' }, `${namespace}:\n  appId: "cli_xxx"\n  appSecret: "xxx"`),
          h('div', { className: 'dsh-feishu-kv' }, settingsPath),
        );
      } else if (view === 'tasks') {
        body = h(TasksView, { state: state ?? {}, t, face, onComplete, busy, pending, justDone, removed });
      } else {
        const selectedChat = (Array.isArray(state?.chats) ? state.chats : []).find((chat) => chat.id === chatId);
        body = h(ChatsView, {
          chats: Array.isArray(state?.chats) ? state.chats : [],
          t,
          face,
          summary,
          transcript,
          // The transcript already carries the same identity; this is what the
          // thread header shows before any message has been read.
          selected: selectedChat,
          self: {
            id: typeof state?.selfId === 'string' ? state.selfId : '',
            name: typeof state?.userName === 'string' ? state.userName : '',
            avatar: typeof state?.selfAvatar === 'string' ? state.selfAvatar : undefined,
          },
          busy,
          chatId,
          hours,
          sub: chatSub,
          onPick: (next) => setChatId(next),
          onRange: (next) => setHours(next),
          onSub: (next) => setChatSub(next),
          onSummarize,
          onFetch,
          onLogin,
          auth: {
            // The block always renders; `showLogin` only decides whether it
            // starts expanded, so the paste box survives a completed login.
            showLogin: state?.userLoggedIn !== true,
            userLoggedIn: state?.userLoggedIn === true,
            userName: typeof state?.userName === 'string' ? state.userName : '',
            onComplete: onCompleteAuth,
          },
        });
      }

      return h('div', { className: 'dsh-feishu-root' },
        header,
        toolbar,
        notice === undefined || notice === null ? null : h(Note, null, notice),
        // A token freezes its permissions at authorization time, so a feature
        // can fail with "Unauthorized" long after the console was updated. The
        // panel names the missing scopes instead of letting that surface as an
        // unexplained button failure.
        Array.isArray(state?.missingScopes) && state.missingScopes.length > 0
          ? h(Note, { tone: 'error' }, t('hint.missingScopes').replace('{scopes}', state.missingScopes.join('、')))
          : null,
        state !== null && state.llmAvailable === false && view === 'chats' ? h(Note, { tone: 'error' }, t('note.noLlm')) : null,
        error === null
          ? null
          : h(Note, { tone: 'error' }, `${t('error.title')}: ${error.message}${error.hint === undefined ? '' : `\n${error.hint}`}`),
        h('div', { className: 'dsh-feishu-body' }, state === null && busy ? h('div', { className: 'dsh-feishu-empty' }, t('loading')) : body),
        // Last child on purpose: the toast floats over the body, and the panel's
        // toolbar controls must stay the first match for a "the panel's buttons"
        // lookup.
        h(Toast, { toast, t, onDismiss: () => setToast(null) }),
      );
    }

    /**
     * The right Sidebar's tab body: a session seat, so it owns a composer.
     * @param {any} props - session slot props (copy plus the Session input face).
     * @returns {any} the panel element.
     */
    function FeishuPanel(props) {
      const t = props.t;
      const face = useInsert(props, t);
      return h(PanelBody, { t, face });
    }

    /**
     * The left sidebar entry's page: the plugin's face when there is no session.
     *
     * It is reached only through `SidebarAction`'s fallback — with a session the
     * entry opens the right Sidebar instead — so what it shows is exactly what
     * needs no session: tasks, the bot's group chats, and DeepSeek summaries.
     * 「加入输入框」 is inert here by construction, and the standing note says why.
     *
     * @param {{ t: Function }} props - root slot props (copy only).
     * @returns {any} the page element.
     */
    function FeishuMainPanel(props) {
      const t = props.t;
      // No composer exists here, so the insertion face is inert rather than
      // fabricated: `available: false` disables every 「加入输入框」 button with
      // the reason instead of writing nowhere.
      const face = { insert: () => {}, inserted: null, available: false, hint: t('action.insertHint') };
      return h('div', { className: 'dsh-feishu-main' }, h(PanelBody, { t, face, notice: t('panel.noSession') }));
    }

    // ── settings card ───────────────────────────────────────────────────────
    /**
     * Fields the card edits, in display order.
     *
     * `secret: true` marks a write-only field: the Host never sends a stored
     * secret back, so an untouched secret input must not clear the stored value.
     */
    const SETTINGS_FIELDS = [
      { key: 'appId', label: 'settings.appId', hint: 'settings.appId.hint', kind: 'text' },
      { key: 'appSecret', label: 'settings.appSecret', hint: 'settings.appSecret.hint', kind: 'secret' },
      { key: 'baseUrl', label: 'settings.baseUrl', hint: 'settings.baseUrl.hint', kind: 'text' },
      { key: 'oauthRedirectUri', label: 'settings.redirect', hint: 'settings.redirect.hint', kind: 'text' },
      { key: 'maxMessages', label: 'settings.maxMessages', hint: 'settings.maxMessages.hint', kind: 'number' },
      { key: 'summaryModel', label: 'settings.summaryModel', hint: 'settings.summaryModel.hint', kind: 'text' },
      { key: 'toolsEnabled', label: 'settings.tools', hint: 'settings.tools.hint', kind: 'boolean' },
    ];

    /**
     * Subscribe to one observable snapshot from a component.
     *
     * `useSyncExternalStore` is used when the shell's React provides it, which
     * is the render-safe way; the state/effect pair is the fallback for a React
     * old enough to lack it.
     * @param {{ getSnapshot: () => any, subscribe: (listener: () => void) => () => void }} source - observable.
     * @returns {any} the current snapshot.
     */
    function useObservable(source) {
      const useSyncExternalStore = react.useSyncExternalStore;
      if (typeof useSyncExternalStore === 'function') {
        return useSyncExternalStore(
          (listener) => source.subscribe(listener),
          () => source.getSnapshot(),
        );
      }
      const [value, setValue] = react.useState(() => source.getSnapshot());
      react.useEffect(() => {
        setValue(source.getSnapshot());
        return source.subscribe(() => setValue(source.getSnapshot()));
      }, [source]);
      return value;
    }

    /** One labelled field of the settings card. */
    function SettingsField({ field, value, onChange, t }) {
      const isBoolean = field.kind === 'boolean';
      const isNumber = field.kind === 'number';
      const isSecret = field.kind === 'secret';
      const input = isBoolean
        ? h('input', {
          type: 'checkbox',
          checked: value === true,
          onChange: (event) => onChange(field.key, event.target.checked),
        })
        : h('input', {
          className: 'dsh-feishu-fieldInput',
          type: isSecret ? 'password' : isNumber ? 'number' : 'text',
          value: value === undefined || value === null ? '' : String(value),
          autoComplete: 'off',
          onChange: (event) => onChange(field.key, event.target.value),
        });
      return h('label', { className: 'dsh-feishu-field' },
        h('span', { className: 'dsh-feishu-fieldLabel' }, t(field.label)),
        input,
        h('span', { className: 'dsh-feishu-fieldHint' }, t(field.hint)),
      );
    }

    /**
     * The plugin's card inside the Plugins settings section.
     *
     * The Host serves this namespace as soon as the plugin activates, but the
     * settings page only draws a card for a namespace some plugin registered a
     * card for — there is no schema-driven form. This is that card, which is why
     * it exists at all.
     */
    function SettingsCard(props) {
      const t = props.t;
      const scope = props.scope;
      const snapshot = useObservable(scope);
      /** Draft values, seeded from the Host and replaced when it changes. */
      const [draft, setDraft] = react.useState({});
      const [status, setStatus] = react.useState(null);
      const [saving, setSaving] = react.useState(false);

      react.useEffect(() => {
        const value = snapshot.value ?? {};
        setDraft({
          appId: value.appId ?? '',
          appSecret: '',
          baseUrl: value.baseUrl ?? '',
          oauthRedirectUri: value.oauthRedirectUri ?? '',
          maxMessages: value.maxMessages ?? '',
          summaryModel: value.summaryModel ?? '',
          toolsEnabled: value.toolsEnabled !== false,
        });
      }, [snapshot.value]);

      const onChange = react.useCallback((key, value) => {
        setDraft((previous) => ({ ...previous, [key]: value }));
        setStatus(null);
      }, []);

      const ready = snapshot.status === 'ready';
      const writable = snapshot.writable === true;

      const onSave = react.useCallback(() => {
        // Validate every field before writing any of them: a half-applied save
        // is worse than a refused one, because the user cannot tell which half
        // landed.
        /** @type {Array<{ field: string, value: unknown }>} */
        const planned = [];
        for (const field of SETTINGS_FIELDS) {
          const next = draft[field.key];
          // An empty box means "no opinion", never "erase this". Every field
          // resolves through a schema default and a stored value is only
          // reachable by having typed it, so a blank draft is either an
          // untouched field or a secret the Host refuses to echo — writing it
          // back would silently destroy the stored value. This is exactly how
          // a first save once wiped the configured redirect URI.
          if (field.kind !== 'boolean' && (next === '' || next === undefined || next === null)) continue;
          if (field.kind === 'number') {
            const parsed = Number(next);
            if (!Number.isFinite(parsed)) {
              setStatus({ tone: 'error', text: t('settings.invalidNumber') });
              return;
            }
            planned.push({ field: field.key, value: parsed });
            continue;
          }
          planned.push({ field: field.key, value: next });
        }
        setSaving(true);
        setStatus(null);
        Promise.all(planned.map((entry) => scope.set(entry.field, entry.value))).then(() => {
          setSaving(false);
          setStatus({ tone: 'ok', text: t('settings.saved') });
        }).catch((error) => {
          setSaving(false);
          setStatus({ tone: 'error', text: `${t('settings.saveFailed')}${error?.message === undefined ? '' : ` (${error.message})`}` });
        });
      }, [draft, scope, t]);

      if (!ready) {
        return h('div', { className: 'dsh-feishu-card' },
          h('p', { className: 'dsh-feishu-fieldHint' },
            snapshot.status === 'loading' ? t('settings.loading') : t('settings.unavailable')),
        );
      }

      // `snapshot.secrets` is not part of the published scope snapshot, so the
      // card never claims to know whether a stored secret exists: the secret
      // field's hint says an empty box keeps the stored value.
      return h('div', { className: 'dsh-feishu-card' },
        h('p', { className: 'dsh-feishu-fieldHint' }, t('settings.intro')),
        SETTINGS_FIELDS.map((field) => h(SettingsField, {
          key: field.key,
          field,
          t,
          value: draft[field.key],
          onChange,
        })),
        h('div', { className: 'dsh-feishu-footer' },
          h('span', {
            className: 'dsh-feishu-status',
            'data-tone': status === null ? 'none' : status.tone,
          }, status === null ? (writable ? '' : t('settings.readOnly')) : status.text),
          h('button', {
            type: 'button',
            className: 'dsh-feishu-btn',
            disabled: saving || !writable,
            onClick: onSave,
          }, saving ? t('settings.saving') : t('settings.save')),
        ),
      );
    }

    // ── plugin body ─────────────────────────────────────────────────────────
    /**
     * Cordis services this bundle waits for.
     *
     * `settingsScope` is what makes the settings card possible: it is the
     * browser-side owner handle over one namespace, and binding it here means a
     * deployment without it simply does not activate this plugin rather than
     * showing a card that cannot save. `layout` is the frame's panel face, which
     * the rail's page uses to hand the centre column back to the Conversation.
     */
    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'settingsScope', 'layout'];

    /**
     * Client plugin body: dictionaries, the tab type, its body, the sidebar's
     * entry and its page, and the settings card.
     * @param {any} ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'feishu-plugin: dictionaries');
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => t('tab.title'),
        guide: [{
          order: 30,
          title: () => t('tab.guide'),
          description: () => t('tab.guide.description'),
          // Without a glyph the guide draws its cube placeholder, so the panel
          // would be the only entry in the add menu with no face.
          icon: FeishuIcon,
        }],
      }), 'feishu-plugin: tab type');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      }, FeishuPanel)), 'feishu-plugin: tab body');
      // The sidebar's foot entry and the page it falls back to. Both seats are
      // root-scoped, which is the whole point: the right Sidebar is keyed by
      // session id and shows nothing on the home screen, so a session-header
      // button used to be the only way in — and it vanished with the session.
      ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: MAIN_PANEL_ID,
        order: 55,
        label: () => t('tab.title'),
        locale: NS,
        inject: () => ({ sidebarRight: ctx.sidebarRight, layout: ctx.layout }),
      }, SidebarAction)), 'feishu-plugin: sidebar entry');
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        // The id the entry selects when it has no session to open beside.
        key: MAIN_PANEL_ID,
        locale: NS,
      }, FeishuMainPanel)), 'feishu-plugin: sidebar entry page');
      // The card is keyed by the settings namespace, which is what pairs this
      // browser contribution with the namespace the host half registers — the
      // settings page never learns what the namespace means.
      const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
      ctx.effect(() => ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NAMESPACE,
        locale: NS,
        inject: () => ({ scope }),
      }, SettingsCard)), 'feishu-plugin: settings card');
    }

    exports.apply = apply;
    exports.inject = inject;
    // Test seam: the view components are module-local closures with no other
    // way in, and a component that cannot be rendered in isolation cannot be
    // tested without a browser and a live host. Exported names are additive
    // and unused by the module system.
    exports.internals = { FeishuPanel, FeishuMainPanel, PanelBody, TasksView, ChatsView, ChatThread, MessageList, MessageBubble, Avatar, DaySeparator, InsertButton, Toast, FeishuIcon, SidebarAction, senderLabel, senderUnknown };
    return module.exports;
  },
});
