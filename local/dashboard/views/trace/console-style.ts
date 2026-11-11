import { installStyles } from "../../charts/sankey";
import { consoleStyles } from "../../components/console-style";

export function traceConsoleStyles() {
  consoleStyles();
  installStyles("trace-console", `
.trace.pe-console .foldbtn,.trace.pe-console input[type=range]{height:var(--lf-control-height);min-height:var(--lf-control-height);max-height:var(--lf-control-height)}
.trace.pe-console .foldbtn{font:inherit}
.trace.pe-console{grid-template-columns:minmax(0,1fr);min-width:0;gap:16px}
.trace-summary{margin:0 0 16px;min-width:0}.trace-summary__title{display:flex;align-items:center;gap:8px;min-width:0}
.trace-summary .trace__title{font-size:20px;margin:0;overflow-wrap:anywhere}.trace-summary .trace__title code{font-size:inherit}
.trace-summary .trace__back{display:inline-flex;min-height:44px;align-items:center;margin:0}
.trace-back-icon{transform:rotate(180deg)}
.trace-summary .trace__prompt{margin:0}.trace-summary .trace__prompt summary{min-height:44px;padding:10px 0;cursor:pointer}
.trace-summary__line{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--ink-2)}
.trace-summary__line>div{display:inline-flex;align-items:center;gap:4px}.trace-summary__line :is(dt,dd){margin:0;font-size:12px;color:var(--ink-2)}
.trace-first-request{display:inline-flex;align-items:center;gap:6px;min-height:44px;background:none;border:0;padding:0;color:var(--accent);font-size:14px}
.trace-summary__reads{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.trace-summary__kv{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;padding:16px 0;margin:0;border-bottom:1px solid var(--line);font-size:12px}
.trace-summary__kv div{min-width:0}.trace-summary__kv dt{color:var(--ink-2)}.trace-summary__kv dd{margin:2px 0 0}
.trace-compact-tree{min-width:0}.trace-compact-tree h3{font-size:14px;margin:0 0 8px}.trace-compact-tree ol{list-style:none;padding:0;margin:0}
.trace-event-row{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:44px;padding:6px 8px;border:0;border-bottom:1px solid var(--line);background:var(--bg);text-align:left;color:var(--ink);text-decoration:none;font-size:12px;cursor:pointer}
.trace-event-row:hover,.trace-event-row[aria-pressed=true]{background:var(--surface);color:var(--ink);text-decoration:none}
.trace-event-row[aria-selected=true]{box-shadow:none;background:var(--lf-muted)}
.trace-event-row__kind{flex:none}.trace-event-row__summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.trace-event-row time{flex:none;font-size:12px;white-space:nowrap}
.session-peek .trace-summary .trace__title{font-size:var(--lf-text-sm)}.session-peek .trace-summary__line>[data-fact=started]{display:none}
.trace-console [hidden]{display:none!important}
.event-console{min-width:0}.event-console__tabs{display:flex;gap:4px}.event-inspector__tabs [aria-selected=true]{background:var(--lf-muted)}
.event-graph-reason{font-size:12px;margin:8px 0 12px}
.event-console__split{display:grid;grid-template-columns:minmax(0,52fr) minmax(0,48fr);gap:16px;min-height:480px;min-width:0}
.event-console__tree{min-width:0;max-height:calc(100dvh - 280px);overflow:auto;border:1px solid var(--line)}
.event-console__tree :is(h2,h3){margin:0;padding:10px 8px;font-size:14px;border-bottom:1px solid var(--line)}
.event-console__heading{display:flex;align-items:center;gap:8px;padding:10px 8px;border-bottom:1px solid var(--line);font-size:12px}
.event-console__heading :is(h2,h3){padding:0;border:0}
.event-console__tree ol{list-style:none;padding:0;margin:0}.trace-event{min-width:0}
.event-console__inspector{min-width:0}
.event-inspector{width:100%;max-height:calc(100dvh - 280px);min-height:480px;overflow:auto;padding:12px;border:1px solid var(--line);background:var(--bg);font-size:14px}
.event-inspector__head{display:flex;align-items:center;gap:8px;min-height:44px}.event-inspector__head>strong{margin-right:auto}
.event-inspector__tabs,.event-inspector__formats{display:flex;gap:4px;margin:4px 0 12px}.event-inspector__tabs .pe-button,.event-inspector__formats .pe-button{border:0}
.event-inspector__digest{font-size:12px;overflow-wrap:anywhere;margin:4px 0}
.event-inspector__preview{min-width:0}.event-inspector .tl__meta{font-size:12px}.event-inspector .tl__text{font-size:14px;overflow-wrap:anywhere}
.event-inspector pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;font-size:12px}
.json-viewer{min-width:0;margin-top:12px}.json-viewer__head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.json-viewer__tree{counter-reset:json-line;font-size:12px}
.json-line{counter-increment:json-line;min-height:44px;padding:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}
.json-line::before{content:counter(json-line);display:inline-block;min-width:24px;padding-right:8px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.json-line code{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.json-line .pe-muted{margin-left:8px;font-size:12px}.json-children{padding-left:12px}
.json-viewer details{min-width:0}.json-viewer summary{cursor:pointer}
.event-inspector .tl__step{display:block}.event-inspector .tl__head{display:flex;flex-wrap:wrap;gap:8px}.event-inspector .tl__body{margin-top:8px}
.event-attributes{margin:0}.event-attributes>div{padding:8px 0;border-bottom:1px solid var(--line)}.event-attributes dt{font-size:12px;color:var(--ink-2)}.event-attributes dd{margin:0}
.ranked-candidates{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-top:12px}
.ranked-candidates .cand{display:table-row;background:transparent;border:0}
.ranked-candidates th,.ranked-candidates td{padding:4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.ranked-candidates th:first-child{width:40px}.ranked-candidates th:nth-child(3){width:48px}.ranked-candidates th:nth-child(4){width:44px}.ranked-candidates th:nth-child(5){width:65px}
.ranked-candidates .cand__desc{display:block;margin:0}.ranked-candidates .cand__desc summary{font-size:12px;overflow-wrap:anywhere}
.ranked-candidates .cand__desc code{font-size:12px;white-space:normal;overflow-wrap:anywhere}
.ranked-candidates .cand__root{display:block;font-size:12px;color:var(--ink-2)}
.event-gantt-axis{display:flex;justify-content:space-between;margin:0;padding:6px 8px;font-size:12px;color:var(--ink-2)}
.event-gantt-track{position:relative;overflow:hidden;min-width:70px;width:32%;height:24px;border-bottom:1px solid var(--line-2);margin:0 4px;flex:none}
.event-gantt-controls{padding:8px;border-bottom:1px solid var(--line);font-size:12px}
.event-gantt-tools{display:flex;align-items:center;flex-wrap:wrap;gap:4px}.event-gantt-tools output{margin-left:auto}
.event-gantt-controls p{margin:8px 0 4px;font-size:12px}
.event-gantt-overview{position:relative;height:24px;background:var(--surface);border:1px solid var(--line);overflow:hidden}
.event-gantt-overview i{position:absolute;top:4px;bottom:4px;width:2px;background:var(--ink-2)}
.event-gantt-overview>span{position:absolute;inset-block:0;background:color-mix(in srgb,var(--ink) 12%,transparent);border:1px solid var(--ink-2)}
.event-gantt-position{display:flex;align-items:center;gap:8px;min-height:44px}.event-gantt-position input{flex:1;min-width:0;min-height:44px;accent-color:var(--accent)}
.event-gantt-bar,.event-gantt-point{position:absolute;top:7px;height:8px;background:var(--accent);min-width:2px}
.event-gantt-point{width:4px!important;height:4px;top:9px;border-radius:50%;transform:translateX(-50%)}
.event-gantt-bar{min-width:1px}
.trace.pe-console{--trace-icon-size:14px;--trace-interval-height:18px;--trace-point-size:4px;--trace-mark-radius:1px;color:var(--lf-foreground);font-family:var(--lf-font-sans);font-size:var(--lf-text-sm);line-height:var(--lf-leading-sm);
--lf-observation-span:light-dark(lab(61.1967% 11.0677 -63.9598),lab(70.1443% 3.01325 -43.2876));--lf-observation-span-line:light-dark(lab(45.2443% 21.8484 -74.0944),lab(71.409% 2.19858 -39.8039));
--lf-observation-generation:light-dark(lab(60.2576% 54.0985 -27.5906),lab(69.2992% 36.3671 -18.5681));--lf-observation-generation-line:light-dark(lab(44.6403% 62.684 -31.9386),lab(70.607% 33.3834 -17.0479));
--lf-observation-event:light-dark(lab(64.1083% -18.1972 86.3685),lab(71.9617% -14.1968 45.8667));--lf-observation-event-line:light-dark(lab(48.9854% -17.4952 129.914),lab(73.0619% -13.2997 41.3837));
--lf-observation-retriever:light-dark(lab(65.0263% -50.6023 42.8364),lab(72.4933% -33.5873 27.1283));--lf-observation-retriever-line:light-dark(lab(50.1918% -59.5612 55.4271),lab(73.5376% -30.776 24.724));
--lf-observation-tool:light-dark(lab(61.8743% 42.999 78.8609),lab(70.451% 26.7202 42.1269));--lf-observation-tool-line:light-dark(lab(46.4091% 53.2312 123.139),lab(71.6738% 24.2027 37.9885));
--lf-observation-guardrail:light-dark(lab(61.0965% 56.6147 33.1618),lab(69.8466% 37.3708 20.841));--lf-observation-guardrail-line:light-dark(lab(45.6514% 66.6325 43.1177),lab(71.1075% 34.2003 18.9727))}
.trace-summary .trace__title{font-size:var(--lf-text-base);font-weight:var(--lf-weight-strong)}
.trace .trace__back,.trace-first-request{min-height:var(--lf-control-height);height:var(--lf-control-height);padding-block:0;color:var(--lf-muted-foreground);font-size:var(--lf-text-sm)}
.trace-summary .trace__prompt summary{min-height:var(--lf-control-height);padding-block:0}
.trace .tl__args summary{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0}
.trace-summary__reads .pe-pill{border-radius:var(--lf-radius-sm);border-color:var(--lf-border);background:var(--lf-muted);color:var(--lf-foreground)}
.trace .trace-event-row{height:var(--lf-control-height);min-height:var(--lf-control-height);padding:0;gap:var(--lf-space-2);background:var(--lf-background);border-color:var(--lf-border);font:var(--lf-weight-regular) var(--lf-text-lg)/var(--lf-space-6) var(--lf-font-sans);color:var(--lf-foreground)}
.trace .trace-event-row:hover{background:var(--lf-accent)}
.trace .trace-event-row__kind{font-size:var(--lf-text-sm);line-height:var(--lf-leading-sm)}
.trace .trace-event-row>.pe-icon{width:var(--trace-icon-size);height:var(--trace-icon-size);color:var(--trace-kind-line)}
.trace :is([role=treeitem],[role=gridcell]){border:0;border-color:var(--lf-border)}
.trace .event-console__tabs>[role=tab]{border-color:var(--lf-border)}
.trace :is(.trace-event-row__kind,.trace-event-row__summary,.trace-event-row time,.json-line code,.json-value,.json-value-preview){border-color:var(--lf-border)}
.trace :is(.trace-event-row__summary,.trace-event-row time){font-size:var(--lf-text-xs);line-height:var(--lf-leading-xs)}
.trace [role=treeitem][aria-selected=false]:not(:hover){background:transparent}
.trace [role=treeitem][aria-selected=false]{color:light-dark(var(--lf-foreground),var(--lf-muted-foreground))}
.trace .trace-event-row[aria-selected=true]{background:var(--lf-muted)}
.trace .trace-event-row[aria-selected=true]::after{content:"";flex:none;width:var(--lf-space-4);height:var(--lf-space-4);background:currentColor;mask:var(--lf-selection-check) center/contain no-repeat}
.trace :is(.trace-event-row,.pe-button,summary):focus-visible{outline:var(--lf-focus-width) solid var(--lf-ring);outline-offset:calc(-1 * var(--lf-focus-width))}
.trace :is(.event-console__tree,.event-inspector){border-color:var(--lf-border);background:var(--lf-card);border-radius:var(--lf-radius-lg)}
.trace .event-inspector{padding:var(--lf-space-4);font-size:var(--lf-text-sm)}
.trace .event-console__heading{border-color:var(--lf-border)}
.trace :is(.event-inspector__head,.event-gantt-position){min-height:var(--lf-control-height)}
.trace .event-inspector__tabs .pe-button[aria-selected=true],.trace .event-inspector__formats .pe-button[aria-pressed=true]{background:var(--lf-muted);box-shadow:none}
.trace .json-viewer__tree{--trace-json-property:light-dark(#005cc5,#79b8ff);--trace-json-string:light-dark(#032f62,#9ecbff);padding:var(--lf-space-2);background:var(--lf-muted);border-radius:var(--lf-radius-md);font-family:var(--lf-font-mono)}
.trace .json-line{min-height:var(--lf-control-height);padding-block:var(--lf-space-1);line-height:var(--lf-leading-xs)}
.trace .json-line:not(summary){min-height:var(--lf-leading-xs);padding-block:0}
.trace.pe-console .json-viewer summary.json-line{height:var(--lf-control-height);min-height:var(--lf-control-height);padding:calc((var(--lf-control-height) - var(--lf-leading-xs))/2) 0;border:0;border-color:var(--lf-border);border-radius:0;font-size:var(--lf-text-xs);line-height:var(--lf-leading-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trace summary.json-line code{white-space:nowrap;overflow-wrap:normal}
.trace .json-line code{font-family:var(--lf-font-mono);font-size:var(--lf-text-xs);line-height:var(--lf-leading-xs);font-weight:var(--lf-weight-regular);color:var(--trace-json-property)}
.trace :is(.json-value,.json-value-preview)[data-json-type=string]{color:var(--trace-json-string)}
.trace :is(.json-value,.json-value-preview):not([data-json-type=string]){color:var(--lf-foreground)}
.trace .event-gantt-track{border-color:var(--lf-border)}
.trace .trace-event-row{--trace-kind:var(--lf-observation-event);--trace-kind-line:var(--lf-observation-event-line)}
.trace [data-event-kind=prompt],.trace [data-event-kind=skill_span],.trace [data-event-kind=native_skill]{--trace-kind:var(--lf-observation-span);--trace-kind-line:var(--lf-observation-span-line)}
.trace [data-event-kind=llm_call]{--trace-kind:var(--lf-observation-generation);--trace-kind-line:var(--lf-observation-generation-line)}
.trace [data-event-kind=search]{--trace-kind:var(--lf-observation-retriever);--trace-kind-line:var(--lf-observation-retriever-line)}
.trace [data-event-kind=tool_call],.trace [data-event-kind=load],.trace [data-event-kind=read_file]{--trace-kind:var(--lf-observation-tool);--trace-kind-line:var(--lf-observation-tool-line)}
.trace [data-event-kind=error]{--trace-kind:var(--lf-observation-guardrail);--trace-kind-line:var(--lf-observation-guardrail-line)}
.trace :is(.event-gantt-bar,.event-gantt-point){background:var(--trace-kind)}
.trace .event-gantt-bar{height:var(--trace-interval-height);top:calc((24px - var(--trace-interval-height))/2);border-radius:var(--trace-mark-radius)}
.trace [aria-selected=true] :is(.event-gantt-bar,.event-gantt-point){box-shadow:0 0 0 var(--lf-border-width) color-mix(in srgb,var(--lf-foreground) 80%,transparent)}
.trace .event-gantt-point{width:var(--trace-point-size)!important;height:var(--trace-point-size);top:calc((24px - var(--trace-point-size))/2)}
.trace :is(.event-gantt-controls,.event-gantt-overview){border-color:var(--lf-border)}
@media(max-width:1023px){
 .event-console__tree{max-height:none}.event-console__split{display:block;min-height:0}
 .event-inspector{position:fixed;inset:0;z-index:80;width:100%;height:100dvh;max-height:none;min-height:0;border:0;padding:12px}
 .trace-summary .trace__title{font-size:var(--lf-text-base)}.trace-summary__line{gap:6px 10px}
}
`);
}
