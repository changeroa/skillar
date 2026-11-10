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
.pe-shell{display:grid;grid-template-columns:var(--lf-sidebar-width) minmax(0,1fr);min-height:100dvh}
.pe-sidebar{position:sticky;top:0;align-self:start;height:100dvh;display:flex;flex-direction:column;border-right:var(--lf-border-width) solid var(--lf-sidebar-border)}
.pe-sidebar>.lf-sidebar{height:100%;min-height:0;width:100%}
.pe-sidebar .brand{width:120px;margin:var(--lf-space-1h) var(--lf-space-2) var(--lf-space-5);height:var(--lf-control-height);min-height:var(--lf-control-height)}
.pe-sidebar__foot{margin-top:auto;display:grid;gap:8px;padding-top:24px}
.pe-source{padding:8px;border-top:1px solid var(--line);display:grid;gap:4px}
.pe-source .live{font-size:12px}
.pe-sidebar__foot .btn{white-space:normal;font-size:12px;text-align:left}
.pe-sidebar__foot :is(.btn,.pe-button){height:var(--lf-control-height);min-height:var(--lf-control-height);padding-block:0;border-color:var(--lf-border);border-radius:var(--lf-radius-md);font-size:var(--lf-text-sm)}
.pe-body{min-width:0}
.pe-jump{display:flex;align-items:center;gap:var(--lf-space-2);flex:none;border:0;font-size:var(--lf-text-sm);color:var(--lf-muted-foreground)}
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
.session-peek.pe-console .pe-button{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0}
.pe-sheet .pe-icon-button,.session-peek.pe-console .pe-icon-button{width:var(--lf-control-height)}
:is(.pe-sheet,.session-peek.pe-console) :is(details.trace__prompt,details.tl__args,details.cand__desc)>summary{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0}
.pe-sheet .pe-button:hover{background:var(--lf-accent)}.pe-sheet .pe-button:focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:var(--lf-focus-offset)}
.pe-sheet .session-facet__modes [aria-pressed=true]{box-shadow:none;background:var(--lf-accent)}
.pe-sheet .session-facet__modes [aria-pressed=true]::after{content:"";width:var(--lf-space-4);height:var(--lf-space-4);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.pe-sheet .pe-source{margin-bottom:12px}
.pe-overlay{position:fixed;inset:0;z-index:100;background:#0007;display:flex;justify-content:center;align-items:flex-start;padding:12vh 16px 16px}
.pe-sessions-region{display:grid;grid-template-columns:minmax(0,1fr);min-width:0}
.pe-sessions-region:has(.session-peek){grid-template-columns:minmax(0,1fr) 560px;gap:16px}
@media(max-width:1279px){.pe-sessions-region:has(.session-peek){grid-template-columns:minmax(0,1fr) 480px}}
@media(max-width:1023px){
 .pe-shell{display:block}.pe-sidebar{display:none}.pe-content{padding:12px}
 .pe-source-toggle{display:inline-flex;flex:none;padding:6px}
 .pe-mobile-nav{display:flex;flex-wrap:nowrap;overflow-x:auto;border-bottom:1px solid var(--line);gap:4px;padding:0 8px}
 .pe-mobile-nav>span{flex:none}.pe-mobile-nav .tab{display:inline-flex;align-items:center;gap:4px;min-height:44px;flex:none;padding:6px;font-size:12px;border:0;color:var(--ink);text-decoration:none;white-space:nowrap}
 .pe-mobile-nav.lf-sidebar{width:100%;flex-direction:row;padding:var(--lf-space-1) var(--lf-space-2);background:var(--lf-sidebar-background)}
 .pe-mobile-nav .lf-nav-item{flex:none}
 .pe-jump kbd{display:none}.pe-jump{padding-inline:8px}
 .pe-sessions-region:has(.session-peek){display:block}.pe-overlay{padding:16px 12px}
}
`);
}
