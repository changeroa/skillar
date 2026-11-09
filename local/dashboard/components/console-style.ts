import { installStyles } from "../charts/sankey";

export function consoleStyles() {
  installStyles("local-console", `
.pe-shell,.pe-console{--fs-title:22px;--fs-body:14px;--fs-sm:14px;--fs-cap:12px;--fs-micro:12px;font-size:14px;line-height:1.5}
.pe-icon{display:inline-block;flex:none;vertical-align:middle}
.pe-shell .sr-only,.pe-console .sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);border:0;white-space:nowrap}
.pe-pill{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:0 7px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:12px;white-space:nowrap;color:var(--ink)}
.pe-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:44px;min-height:44px;padding:6px 10px;border:1px solid var(--line-2);border-radius:2px;background:var(--bg);color:var(--ink);font-size:14px;text-decoration:none;cursor:pointer}
.pe-button:hover{background:var(--surface);color:var(--ink);text-decoration:none}
.pe-button:disabled{color:var(--ink-2);cursor:not-allowed}
.pe-icon-button{width:44px;padding:8px}
.pe-muted{color:var(--ink-2)}
.pe-shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100dvh}
.pe-sidebar{position:sticky;top:0;align-self:start;height:100dvh;display:flex;flex-direction:column;padding:16px 12px;border-right:1px solid var(--line);background:var(--surface)}
.pe-sidebar .brand{width:120px;margin:0 8px 20px}
.pe-nav{display:flex;flex-direction:column;gap:4px}
.pe-nav__group{margin:12px 12px 4px;font-size:12px;color:var(--ink-2)}
.pe-nav .tab{display:flex;align-items:center;justify-content:flex-start;gap:10px;min-height:44px;padding:8px 12px;border:0;border-radius:2px;color:var(--ink);text-decoration:none;font-size:14px}
.pe-nav .tab[aria-current=page]{background:var(--bg);box-shadow:inset 3px 0 var(--accent);font-weight:600}
.pe-sidebar__foot{margin-top:auto;display:grid;gap:8px;padding-top:24px}
.pe-source{padding:8px;border-top:1px solid var(--line);display:grid;gap:4px}
.pe-source .live{font-size:12px}
.pe-sidebar__foot .btn{white-space:normal;font-size:12px;text-align:left}
.pe-body{min-width:0}
.pe-topbar{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--bg)}
.pe-breadcrumb{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:var(--ink-2)}
.pe-breadcrumb a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;color:var(--ink)}
.pe-breadcrumb code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pe-jump{flex:none;border:0;font-size:12px;color:var(--ink-2)}
.pe-jump kbd{font-family:var(--font-mono);padding:1px 4px;border:1px solid var(--line);border-radius:2px}
.pe-content{padding:16px;min-width:0}
.pe-mobile-nav{display:none}
.pe-source-toggle{display:none}
.pe-sheet-overlay{position:fixed;inset:0;z-index:100;background:var(--lf-overlay-backdrop);display:flex;justify-content:flex-end}
.pe-sheet{width:100%;max-width:440px;height:100dvh;display:flex;flex-direction:column;overflow:hidden;background:var(--lf-modal);color:var(--lf-foreground);font:var(--lf-weight-regular) var(--lf-text-lg)/var(--lf-menu-leading) var(--lf-font-sans);box-shadow:var(--lf-shadow-modal);border-inline-start:var(--lf-border-width) solid var(--lf-border);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.pe-sheet__head,.pe-sheet__actions{display:flex;flex:none;align-items:center;justify-content:space-between;gap:var(--lf-space-2);padding:var(--lf-space-4);border-bottom:1px solid var(--lf-border)}
.pe-sheet__head h2{font-size:var(--lf-text-lg);font-weight:var(--lf-weight-strong);margin:0}.pe-sheet__body{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:var(--lf-space-4)}
.pe-sheet__actions{border-top:1px solid var(--lf-border);border-bottom:0;padding-bottom:max(var(--lf-space-4),env(safe-area-inset-bottom))}
.pe-sheet .pe-button{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0;border-color:var(--lf-border);border-radius:var(--lf-radius-md);font:inherit;color:var(--lf-foreground);background:var(--lf-modal)}
.pe-sheet .pe-icon-button{width:var(--lf-control-height)}
.pe-sheet .pe-button:hover{background:var(--lf-accent)}.pe-sheet .pe-button:focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:var(--lf-focus-offset)}
.pe-sheet .session-facet__modes [aria-pressed=true],.pe-sheet .pe-nav .tab[aria-current=page]{box-shadow:none;background:var(--lf-accent)}
.pe-sheet .session-facet__modes [aria-pressed=true]::after,.pe-sheet .pe-nav .tab[aria-current=page]::after{content:"";width:var(--lf-space-4);height:var(--lf-space-4);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.pe-sheet .pe-nav .tab[aria-current=page]::after{margin-inline-start:auto}
.pe-sheet .pe-source{margin-bottom:12px}.pe-sheet .pe-nav{margin-top:16px}
.pe-overlay{position:fixed;inset:0;z-index:100;background:#0007;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px}
.pe-command{width:520px;max-width:100%;max-height:75dvh;overflow:auto;padding:16px;background:var(--bg);border:1px solid var(--line-2);border-radius:4px}
.pe-command__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pe-command h2{margin:0;font-size:18px}
.pe-command input{width:100%;min-height:44px;padding:8px;border:1px solid var(--line-2);background:var(--bg);margin:12px 0}
.pe-command [role=option]{width:100%;justify-content:flex-start;border:0;text-align:left}
.pe-command [aria-selected=true]{background:var(--surface);box-shadow:inset 3px 0 var(--accent)}
.pe-command__help{font-size:12px;color:var(--ink-2)}
.pe-sessions-region{display:grid;grid-template-columns:minmax(0,1fr);min-width:0}
.pe-sessions-region:has(.session-peek){grid-template-columns:minmax(0,1fr) 560px;gap:16px}
@media(max-width:1279px){.pe-sessions-region:has(.session-peek){grid-template-columns:minmax(0,1fr) 480px}}
@media(max-width:1023px){
 .pe-shell{display:block}.pe-sidebar{display:none}.pe-topbar{padding:0 12px}.pe-content{padding:12px}
 .pe-source-toggle{display:inline-flex;flex:none;padding:6px}.pe-topbar{gap:4px}
 .pe-mobile-nav{display:flex;flex-wrap:nowrap;overflow-x:auto;border-bottom:1px solid var(--line);gap:4px;padding:0 8px}
 .pe-mobile-nav>span{flex:none}.pe-mobile-nav .tab{display:inline-flex;align-items:center;gap:4px;min-height:44px;flex:none;padding:6px;font-size:12px;border:0;color:var(--ink);text-decoration:none;white-space:nowrap}
 .pe-mobile-nav [aria-current=page]{box-shadow:inset 0 -3px var(--accent)}
 .pe-jump kbd{display:none}.pe-jump{padding-inline:8px}
 .pe-breadcrumb{gap:5px}.pe-breadcrumb code{max-width:120px}
 .pe-sessions-region:has(.session-peek){display:block}.pe-overlay{padding:16px 12px}
}
`);
}
