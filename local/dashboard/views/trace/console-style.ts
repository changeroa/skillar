import { installStyles } from "../../charts/sankey";
import { consoleStyles } from "../../components/console-style";

export function traceConsoleStyles() {
  consoleStyles();
  installStyles("trace-console", `
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
.session-peek .trace-summary .trace__title{font-size:16px}.session-peek .trace-summary__line>[data-fact=started]{display:none}
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
.trace.pe-console{--trace-icon-size:14px;--trace-interval-height:18px;--trace-point-size:4px;--trace-mark-radius:1px;color:var(--lf-foreground);font-family:var(--lf-font-sans);font-size:var(--lf-text-sm);line-height:var(--lf-leading-sm)}
.trace-summary .trace__title{font-size:var(--lf-text-xl);font-weight:var(--lf-weight-strong)}
.trace .trace__back,.trace-first-request{min-height:var(--lf-control-height);height:var(--lf-control-height);padding-block:0;color:var(--lf-muted-foreground);font-size:var(--lf-text-sm)}
.trace-summary .trace__prompt summary{min-height:var(--lf-control-height);padding-block:0}
.trace .tl__args summary{height:var(--lf-control-height);min-height:var(--lf-control-height);min-width:var(--lf-control-height);padding-block:0}
.trace-summary__reads .pe-pill{border-radius:var(--lf-radius-sm);border-color:var(--lf-border);background:var(--lf-muted);color:var(--lf-foreground)}
.trace .trace-event-row{height:var(--lf-control-height);min-height:var(--lf-control-height);padding:0 var(--lf-space-2);gap:var(--lf-space-2);background:var(--lf-background);border-color:var(--lf-border);font:var(--lf-weight-regular) var(--lf-text-xs)/var(--lf-leading-xs) var(--lf-font-sans);color:var(--lf-foreground)}
.trace .trace-event-row:hover{background:var(--lf-accent)}
.trace .trace-event-row__kind{font-size:var(--lf-text-sm);line-height:var(--lf-leading-sm)}
.trace .trace-event-row>.pe-icon{width:var(--trace-icon-size);height:var(--trace-icon-size)}
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
.trace summary.json-line{height:auto;min-height:var(--lf-control-height)}
.trace .json-line code{font-family:var(--lf-font-mono);font-size:var(--lf-text-xs);color:var(--trace-json-property)}
.trace .json-value[data-json-type=string]{color:var(--trace-json-string)}
.trace .event-gantt-track{border-color:var(--lf-border)}
.trace .trace-event-row{--trace-kind:var(--lf-observation-event)}
.trace [data-event-kind=prompt],.trace [data-event-kind=skill_span],.trace [data-event-kind=native_skill]{--trace-kind:var(--lf-observation-span)}
.trace [data-event-kind=llm_call]{--trace-kind:var(--lf-observation-generation)}
.trace [data-event-kind=search]{--trace-kind:var(--lf-observation-retriever)}
.trace [data-event-kind=tool_call],.trace [data-event-kind=load],.trace [data-event-kind=read_file]{--trace-kind:var(--lf-observation-tool)}
.trace [data-event-kind=error]{--trace-kind:var(--lf-observation-guardrail)}
.trace :is(.event-gantt-bar,.event-gantt-point){background:var(--trace-kind)}
.trace .event-gantt-bar{height:var(--trace-interval-height);top:calc((24px - var(--trace-interval-height))/2);border-radius:var(--trace-mark-radius)}
.trace .event-gantt-point{width:var(--trace-point-size)!important;height:var(--trace-point-size);top:calc((24px - var(--trace-point-size))/2)}
.trace :is(.event-gantt-controls,.event-gantt-overview){border-color:var(--lf-border)}
@media(max-width:1023px){
 .event-console__tree{max-height:none}.event-console__split{display:block;min-height:0}
 .event-inspector{position:fixed;inset:0;z-index:80;width:100%;height:100dvh;max-height:none;min-height:0;border:0;padding:12px}
 .trace-summary .trace__title{font-size:18px}.trace-summary__line{gap:6px 10px}
}
`);
}
