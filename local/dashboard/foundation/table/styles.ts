const installed = new WeakSet<Document>();

/** Shared paint stays below product adapters, with one scope for both renderers. */
export function tableStyles(): void {
  if (typeof document === "undefined" || installed.has(document)) return;
  const css = `
.lf-table-surface{--lf-table-row-height:var(--lf-control-height);min-width:0;color:var(--lf-foreground);font:var(--lf-weight-regular) var(--lf-text-xs)/var(--lf-leading-xs) var(--lf-font-sans);-webkit-font-smoothing:antialiased}
.lf-table-surface[data-density=normal]{--lf-table-row-height:96px}
.lf-table-surface:is([data-density=spacious],[data-density=comfortable]){--lf-table-row-height:256px}
.lf-table-surface .lf-table-scroll{overflow-x:auto;min-width:0}
.lf-table-surface table{width:100%;margin:0;border-collapse:separate;border-spacing:0;table-layout:auto;color:inherit;font:var(--lf-weight-regular) var(--lf-text-sm)/var(--lf-leading-sm) var(--lf-font-sans);background:transparent}
.lf-table-surface caption{text-align:start;padding:var(--lf-space-2) 0;color:var(--lf-muted-foreground);font-size:var(--lf-text-xs);line-height:var(--lf-leading-xs)}
.lf-table-surface :is(th,td){box-sizing:border-box;border:0;border-bottom:var(--lf-border-width) solid var(--lf-border);border-radius:0;text-align:start;vertical-align:middle}
.lf-table-surface th{height:calc(var(--lf-control-height) + var(--lf-space-2));padding:var(--lf-space-1);color:var(--lf-muted-foreground);background:var(--lf-background);font:var(--lf-weight-strong) var(--lf-text-sm)/var(--lf-leading-sm) var(--lf-font-sans)}
.lf-table-surface td{height:var(--lf-table-row-height);padding:0 var(--lf-space-1);font:var(--lf-weight-regular) var(--lf-text-xs)/var(--lf-leading-xs) var(--lf-font-sans);overflow-wrap:anywhere}
.lf-table-surface :is(th,td):first-child{padding-inline-start:var(--lf-space-2)}
.lf-table-surface tbody tr:last-child td{border-bottom:0}
.lf-table-surface tbody tr{box-shadow:none;background:transparent;font:var(--lf-weight-regular) var(--lf-text-xs)/var(--lf-leading-xs) var(--lf-font-sans)}
.lf-table-surface tbody tr:hover{background:var(--lf-accent)}
.lf-table-surface tbody tr[data-selected=true]{background:var(--lf-muted);box-shadow:none}
.lf-table-surface tbody tr[data-selected=true]:not(:has(.lf-table-check)) td:first-child{position:relative;padding-inline-start:calc(var(--lf-space-2) + var(--lf-overlay-icon-size) + var(--lf-space-1))}
.lf-table-surface tbody tr[data-selected=true] td:first-child::before{content:"";position:absolute;inset-inline-start:var(--lf-space-2);top:50%;transform:translateY(-50%);width:var(--lf-overlay-icon-size);height:var(--lf-overlay-icon-size);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.lf-table-surface tbody tr:has(.lf-table-check)[data-selected=true] td:first-child::before{display:none}
.lf-table-surface .lf-table-sort{display:flex;align-items:center;justify-content:flex-start;gap:var(--lf-space-1);width:100%;height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);margin:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}
.lf-table-sort>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lf-table-sort>svg{flex:none;color:var(--lf-icon-foreground)}
.lf-table-surface :is(.lf-table-scroll,[tabindex],a,button):focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:calc(-1 * var(--lf-focus-width))}
.lf-table-surface .lf-table-check{display:inline-flex;vertical-align:middle}
.lf-table-check .lf-checkbox>span:last-child{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.lf-table-surface .lf-table-select{width:calc(var(--lf-control-height) + var(--lf-space-3));white-space:nowrap}
.lf-table-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lf-space-2);min-width:0;margin-block:var(--lf-space-1);color:var(--lf-foreground);font:var(--lf-weight-regular) var(--lf-text-sm)/var(--lf-leading-sm) var(--lf-font-sans)}
.lf-table-toolbar>.lf-field:has(.lf-search){flex:1;min-width:min(100%,220px)}
.lf-table-toolbar .lf-field>label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.lf-table-toolbar .lf-field{margin:0;gap:0;min-width:0}
.lf-table-toolbar .lf-search{width:100%}
.lf-table-pagination{container-type:inline-size;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:var(--lf-space-4);min-width:0;color:var(--lf-foreground);font:var(--lf-weight-strong) var(--lf-text-sm)/var(--lf-leading-sm) var(--lf-font-sans)}
.lf-table-surface>.lf-table-pagination{margin-block:var(--lf-space-2)}
.lf-table-pagination .lf-field{display:flex;align-items:center;gap:var(--lf-space-2);margin:0}
.lf-table-pagination .lf-field>label{margin:0;white-space:nowrap;font:inherit}
.lf-table-pagination .lf-select-wrap{width:70px}
.lf-table-pagination .lf-table-total{margin-inline-end:auto;color:var(--lf-muted-foreground);font-weight:var(--lf-weight-regular)}
.lf-table-page{white-space:nowrap}
.lf-table-page-actions{display:flex;flex-wrap:wrap;gap:var(--lf-space-2)}
.lf-table-surface .lf-table-empty{height:96px;padding:var(--lf-space-6);text-align:center;color:var(--lf-muted-foreground);font:var(--lf-weight-regular) var(--lf-text-sm)/var(--lf-leading-sm) var(--lf-font-sans)}
.lf-table-surface tr:has(.lf-table-empty):hover{background:transparent}
.lf-table-placeholder{display:block;width:100%;height:var(--lf-leading-xs);margin-block:var(--lf-space-1);border-radius:var(--lf-radius-sm);background:var(--lf-muted)}
.lf-table-loading{margin-block:var(--lf-space-2);color:var(--lf-muted-foreground);font:inherit}
.lf-facet-panel{min-width:0;color:var(--lf-foreground);font:var(--lf-weight-regular) var(--lf-text-xs)/var(--lf-leading-xs) var(--lf-font-sans)}
.lf-facet-panel>p{margin:var(--lf-space-1) 0 var(--lf-space-3);color:var(--lf-muted-foreground);font:inherit}
.lf-facet{min-width:0;margin:0 0 var(--lf-space-2);padding:0;border:0}
.lf-facet>legend{width:100%;padding:0}
.lf-facet-heading{display:flex;align-items:center;gap:var(--lf-space-1);min-width:0}
.lf-facet-heading>.lf-button{font-size:var(--lf-text-xs);line-height:var(--lf-leading-xs);padding:var(--lf-space-1) var(--lf-space-2);color:var(--lf-foreground-secondary);border-radius:var(--lf-radius-md)}
.lf-facet-heading>.lf-button:first-child{flex:1;justify-content:flex-start;font-weight:var(--lf-weight-strong)}
.lf-facet-heading[data-active=true]{border-radius:var(--lf-radius-md);background:var(--lf-muted)}
.lf-facet-heading[data-active=true]>.lf-button{background:var(--lf-muted)}
.lf-facet-heading>.lf-button svg{width:var(--lf-overlay-icon-size);height:var(--lf-overlay-icon-size)}
.lf-facet-heading>[aria-expanded=false] svg{transform:rotate(-90deg)}
.lf-facet-modes{display:flex;gap:var(--lf-space-half);margin:var(--lf-space-1) var(--lf-space-2);padding:var(--lf-space-half);border-radius:var(--lf-radius-md);background:var(--lf-muted)}
.lf-facet-modes>.lf-button{flex:1;min-width:0;font-size:var(--lf-text-xs);font-weight:var(--lf-weight-strong)}
.lf-facet-modes>[aria-pressed=true]{background:var(--lf-background)}
.lf-facet-modes>[aria-pressed=true]::before{content:"";width:var(--lf-overlay-icon-size);height:var(--lf-overlay-icon-size);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.lf-facet-values{display:grid;min-width:0;padding-inline:var(--lf-space-2)}
.lf-facet-choice{display:flex;align-items:center;gap:var(--lf-space-1h);min-width:0;min-height:var(--lf-control-height);border-radius:var(--lf-radius-sm)}
.lf-facet-choice:hover{background:var(--lf-accent)}
.lf-facet-choice>.lf-checkbox{flex:1;min-width:0;font:inherit;gap:var(--lf-space-1h)}
.lf-facet-choice .lf-checkbox>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lf-facet-choice>span{color:var(--lf-muted-foreground);font-variant-numeric:tabular-nums}
.lf-facet-values>.lf-field{margin-block:var(--lf-space-1)}
.lf-facet-values>.lf-field>label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:768px){.lf-table-pagination{justify-content:flex-start;gap:var(--lf-space-2)}.lf-table-pagination .lf-table-total{flex-basis:100%}}
@media(forced-colors:active){.lf-table-surface :is(.lf-table-scroll,[tabindex],a,button):focus-visible{outline-color:CanvasText}}
`;
  if ("adoptedStyleSheets" in document && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } else {
    const sheet = document.createElement("style");
    sheet.setAttribute("data-sheet", "lf-table");
    sheet.textContent = css;
    document.head.append(sheet);
  }
  installed.add(document);
}
