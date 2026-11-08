import { installStyles } from "../../charts/sankey";
const WORKSPACES_CSS = `
.ws { display: grid; gap: var(--s-4); }
.ws__head { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
.ws__back { display: inline-flex; align-items: center; gap: var(--s-1); justify-self: start; min-height: 32px; color: var(--ink-2); font-size: var(--fs-sm); font-weight: 500; text-decoration: none; }
.ws__back:hover { color: var(--ink); }
.ws__backbtn { justify-self: start; text-decoration: none; }
.ws__title { margin: 0; font-size: var(--fs-title); font-weight: 600; letter-spacing: -0.01em; line-height: 1.4; overflow-wrap: anywhere; }
.ws__meta { display: flex; flex-wrap: wrap; gap: var(--s-3) var(--s-6); margin: 0; }
.ws__meta > div { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.ws__meta dt { color: var(--ink-3); font-size: var(--fs-cap); font-weight: 500; }
.ws__meta dd { margin: 0; color: var(--ink); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ws__id { font-family: var(--font-mono); font-size: var(--fs-cap); color: var(--ink-2); }
.ws__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.ws__block { padding: var(--s-4) var(--s-5); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.ws__h { margin: 0; color: var(--ink-3); font-size: var(--fs-cap); font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }

.wslist { list-style: none; margin: 0; padding: 0; }
.wsrow { display: grid; grid-template-columns: minmax(min-content, auto) minmax(0, 1fr) auto; grid-template-areas: "title tag when" "meta meta when" "sum sum sum"; align-items: baseline; gap: var(--s-1) var(--s-3); padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line); transition: background-color var(--t-micro); }
.wsrow:last-child { border-bottom: 0; }
.wsrow:hover, .wsrow:has(.wsrow__title:focus-visible) { background: var(--wash); }
.wsrow__title { grid-area: title; min-width: 0; color: var(--ink); font-size: var(--fs-sm); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.wsrow__title:hover { color: var(--ink); text-decoration: underline; }
.wsrow .tag { grid-area: tag; align-self: center; justify-self: start; }
.wsrow__when { grid-area: when; color: var(--ink-2); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wsrow__meta { grid-area: meta; }
.wsrow__sum { grid-area: sum; }

.wssteps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.step { display: grid; gap: var(--s-1); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-sm); }
.step__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.step__id { color: var(--ink); font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: 600; }
.step__row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); }
.step__k { min-width: 4.5rem; color: var(--ink-3); font-size: var(--fs-cap); }
.step__v { display: flex; flex-wrap: wrap; gap: var(--s-1); min-width: 0; }
.step__tools { margin: 0; }
.skill--missing { color: var(--ink-3); border-style: dashed; }
.skill__tag { margin-inline-start: var(--s-1); color: var(--ink-3); font-size: var(--fs-micro); font-weight: 500; }

.tabsets, .panes, .spans, .turns { list-style: none; margin: 0; padding: 0; }
.tabsets { display: grid; gap: var(--s-4); }
.tabset__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2); margin: 0 0 var(--s-2); }
.tabset__name { color: var(--ink-2); font-size: var(--fs-cap); font-weight: 600; }
.panes { display: grid; gap: var(--s-2); }
.pane { border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); }
.pane__sum, .turn__sum { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); cursor: pointer; list-style: none; border-radius: var(--r-sm); }
.pane__sum::-webkit-details-marker, .turn__sum::-webkit-details-marker { display: none; }
.pane__sum { padding: var(--s-2) var(--s-3); min-height: 36px; }
.pane__sum:hover, .turn__sum:hover { background: var(--wash); }
.pane__name { color: var(--ink); font-size: var(--fs-sm); font-weight: 600; overflow-wrap: anywhere; }
.pane__meta, .sess__meta, .turn__meta { color: var(--ink-3); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; }
.pane__body { display: grid; gap: var(--s-3); padding: 0 var(--s-3) var(--s-3); }
.chev { color: var(--ink-3); flex: none; transition: transform var(--t-micro); }
details[open] > summary .chev { transform: rotate(90deg); }

.sess { display: grid; gap: var(--s-2); padding-inline-start: var(--s-3); border-inline-start: 1px solid var(--line); }
.sess__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.sess__link { font-size: var(--fs-cap); font-weight: 500; }
.sess__when { color: var(--ink-2); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; white-space: nowrap; }

.turns { display: grid; gap: var(--s-1); }
.turn__sum { padding: var(--s-1) var(--s-2); min-height: 32px; }
.turn__n { color: var(--ink); font-size: var(--fs-sm); font-weight: 500; }
.turn__time { color: var(--ink-3); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; }
.turn__none { margin: 0; padding: 0 var(--s-2) var(--s-2) var(--s-5); }

.spans { display: grid; gap: var(--s-2); padding: var(--s-1) 0 var(--s-2) var(--s-5); }
.span { display: grid; gap: var(--s-1); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--wash); }
.span__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.span__name { color: var(--ink); font-size: var(--fs-sm); font-weight: 600; overflow-wrap: anywhere; }
.span__tokens { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); margin: 0; }
.evidence { min-width: 0; margin: var(--s-2) 0; font-size: var(--fs-sm); overflow-wrap: anywhere; }
.evidence > summary { cursor: pointer; min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); padding: var(--s-2); border-radius: var(--r-sm); }
.evidence > summary:hover { background: var(--wash); }
.evidence__body { display: grid; gap: var(--s-2); padding: var(--s-2); }
.evidence__body p, .evidence__body h3 { margin: 0; }
.evidence__body h3 { font-size: var(--fs-sm); font-weight: 600; }
.evidence__body ul, .evidence__body ol { margin: 0; padding-inline-start: var(--s-5); display: grid; gap: var(--s-2); }
.evidence__body code { display: block; font-family: var(--font-mono); font-size: var(--fs-cap); white-space: pre-wrap; overflow-wrap: anywhere; }
.evidence__body a { display: inline-block; padding-block: var(--s-3); }
.turn { scroll-margin-top: var(--s-12); }
/* Nested tree tracks must shrink with the card, not with the longest metadata label. */
.tabsets, .panes, .turns, .spans, .pane__body, .sess, .evidence__body { grid-template-columns: minmax(0, 1fr); }

@media (max-width: 639.98px) {
  .ws__head, .ws__block { padding: var(--s-4); }
  .ws__meta { gap: var(--s-3) var(--s-5); }
  /* A spec name can be 64 characters, so the row stacks instead of racing the title against the tag. */
  .wsrow { grid-template-columns: minmax(0, 1fr); grid-template-areas: "title" "tag" "when" "meta" "sum"; }
  .spans, .turn__none { padding-inline-start: var(--s-3); }
}
`;

installStyles("workspaces", WORKSPACES_CSS);
