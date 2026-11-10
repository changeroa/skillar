import { installStyles } from "../../charts/sankey";
import { consoleStyles } from "../../components/console-style";

export function sessionsStyles() {
  consoleStyles();
  installStyles("sessions-console", `
.sessions-console{min-width:0}.sessions-console .page-title{margin:0 0 12px}.sessions-console .page-title h1,.sessions-console .page-title h2{font-size:22px;margin:0}
.sessions-console .page-title p{margin:4px 0 0;color:var(--ink-2);font-size:12px}
.session-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.session-toolbar>.lf-table-toolbar{flex:1;margin:0}.session-toolbar .lf-field:has(select){max-width:160px}
.session-toolbar .field{min-height:44px;font-size:12px;padding:6px 8px;width:auto}
.session-search{display:flex;align-items:center;flex:1;min-width:220px;gap:8px}
.session-search input{flex:1;width:100%;min-width:0;min-height:44px;background:var(--bg);border:1px solid var(--line-2);padding:8px;font-size:14px}
.session-toolbar__count{font-size:12px;white-space:nowrap;color:var(--ink-2)}
.session-menu{position:relative;font-size:12px}.session-menu>summary{list-style:none;font-size:12px}.session-menu>summary::-webkit-details-marker{display:none}
.session-menu__body{position:absolute;right:0;top:100%;width:220px;padding:8px;z-index:20;background:var(--bg);border:1px solid var(--line-2);max-height:65dvh;overflow:auto}
.session-menu__body label{display:flex;align-items:center;gap:8px;min-height:44px}.session-menu__body label:has(select){display:grid}
.session-menu input,.session-facet input[type=checkbox]{accent-color:var(--accent)}
.session-applied{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.session-applied:empty{display:none}
.session-filter-pill{border-radius:10px;font-size:12px;max-width:100%;gap:8px}.session-filter-pill code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:28ch}
.sessions-body{display:grid;grid-template-columns:232px minmax(0,1fr);gap:16px}
.session-facets{border-right:1px solid var(--line);padding-right:12px;min-width:0}
.pe-sheet .session-facets{display:block;border:0;padding:0}
.session-sheet-period{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;font-size:12px}
.session-sheet-period select{min-width:160px;min-height:44px}
.session-facets__scope{font-size:12px;color:var(--ink-2);margin:4px 0 12px}
.session-facet{margin:0 0 16px;border:0;border-bottom:1px solid var(--line);padding:0 0 12px;min-width:0}
.session-facet legend{font-weight:600;padding:0;font-size:12px}
.session-facet__modes{display:flex;margin:4px 0}.session-facet__modes .pe-button{flex:1;font-size:12px}
.session-facet__modes [aria-pressed=true]{background:var(--lf-muted)}
.session-facet>.field{width:100%;font-size:12px}
.session-facet__choice{min-height:44px;display:flex;align-items:center;gap:8px;font-size:12px}
.session-facet__choice>span:first-of-type{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-facet__choice code{font-size:12px}
.session-results{min-width:0}.session-histogram{margin:0 0 12px;padding:8px 0;border-bottom:1px solid var(--line)}
.session-histogram figcaption{font-size:12px}.session-histogram__plot{overflow:auto}
.session-histogram svg{display:block}.session-histogram text{font-size:12px;fill:var(--ink-2)}
.session-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}
.session-table-frame{overflow-x:auto}.session-table th,.session-table td{padding:0 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
.session-table th{height:44px;font-weight:500;color:var(--ink-2)}.session-table th>button{display:flex;align-items:center;justify-content:space-between;gap:4px;background:none;border:0;padding:0;color:inherit;min-height:44px;width:100%;cursor:pointer}
.session-table td{height:44px}.session-table[data-density=normal] td{height:52px}.session-table[data-density=comfortable] td{height:64px}
.session-table .cell-started{width:112px}.session-table .cell-runtime{width:106px}.session-table .cell-state{width:90px}
.session-table .cell-reads,.session-table .cell-candidates{width:118px}.session-table .cell-duration{width:76px}
.session-table .cell-search,.session-table .cell-load{width:125px}.session-table .cell-attribution{width:115px}.session-table .cell-id{width:160px}
.session-table .cell-prompt{width:auto;min-width:160px}.session-table .rowlink{display:flex;align-items:center;min-height:44px;color:var(--ink);font-size:12px;text-decoration:none;overflow:hidden}
.session-table .rowlink>span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.session-table-frame.lf-table-surface .session-table{table-layout:fixed}
.session-table-frame.lf-table-surface .rowlink{height:var(--lf-control-height);min-height:var(--lf-control-height);font:inherit;color:inherit}
.session-table-frame.lf-table-surface .session-table :is(th,td){padding:0 var(--lf-space-2)}
.session-table-frame.lf-table-surface .rowlink>span{-webkit-line-clamp:1}
.session-table-frame.lf-table-surface .session-table td{height:var(--lf-table-row-height)}
.session-table__skills{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:4px 0}
.session-table__skills .pe-pill{max-width:100%}.session-table__skills code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-table [data-state=loaded]{color:var(--ok)}.session-table [data-state=exposed_only]{color:var(--warn)}.session-table [data-state=aborted]{color:var(--bad)}
.session-facets-toggle{display:none}.sessions-console[data-peek=true] .sessions-body{display:block}
.sessions-console[data-peek=true] .session-facets,.sessions-console[data-peek=true] .session-histogram{display:none}
.sessions-console[data-peek=true] .session-table .cell-candidates{display:none}
.sessions-console[data-peek=true] .session-table .cell-reads{width:100px}
.sessions-console .sessions__foot{font-size:12px;margin-top:12px}
@media(max-width:1279px){.sessions-body{display:block}.session-facets{display:none}.session-facets-toggle{display:inline-flex}.sessions-body[data-facets-open=true]>.session-facets{display:block;border:1px solid var(--line);padding:12px;margin-bottom:12px}}
@media(max-width:639px){
 .session-toolbar{gap:6px}.session-search{flex-basis:100%;min-width:0}.session-search>.pe-icon{display:none}
 .session-toolbar .pe-button{padding-inline:7px;font-size:12px}.session-toolbar__count{margin-left:auto}
 .session-histogram{display:block}.session-table-frame{overflow:visible}.session-table,.session-table tbody{display:block}
 .session-table caption{position:absolute}.session-table thead{display:none}
 .session-table tr{display:grid;grid-auto-flow:row dense;grid-template-columns:1.1fr .9fr .9fr .8fr;gap:0 6px;padding:8px 0;border-bottom:1px solid var(--line)}
 .session-table td{display:none;border:0;height:auto!important;padding:0;width:auto!important;min-width:0}
 .session-table-frame.lf-table-surface .session-table td{border-bottom:0}
 .session-table-frame.lf-table-surface .session-table :is(th,td){padding:0}
 .session-table .cell-started,.session-table .cell-runtime,.session-table .cell-state,.session-table .cell-duration{display:block;font-size:12px}
 .session-table .cell-started{grid-column:1}.session-table .cell-runtime{grid-column:2}.session-table .cell-state{grid-column:3}.session-table .cell-duration{grid-column:4;text-align:right}
 .session-table .cell-runtime .pe-pill{font-size:11px;padding:0 4px}.session-table .cell-runtime code{display:none}
 .session-table .cell-prompt{display:block;grid-column:1/-1;grid-row:2}.session-table .rowlink{min-height:44px;font-size:14px}
 .session-table .cell-reads{display:block;grid-column:1/-1;grid-row:3}.session-table .cell-reads::before{content:"읽은 스킬 ";color:var(--ink-2)}
 .session-table .cell-reads>span{display:inline-flex}.session-table .cell-reads>.session-table__skills{padding:0}
 .session-table .pe-pill{white-space:normal}.session-table .cell-candidates{display:none}
 .session-table[data-custom-columns=true] :is(.cell-id,.cell-search,.cell-load,.cell-attribution,.cell-candidates){display:block;grid-column:1/-1}
 .session-table[data-custom-columns=true] td:is(.cell-id,.cell-search,.cell-load,.cell-attribution,.cell-candidates)::before{content:attr(data-label);display:inline-block;margin-right:6px;color:var(--ink-2)}
 .session-menu[data-control=columns] .session-menu__body{left:0;right:auto}
}
`);
}
