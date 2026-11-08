export const TRACE_CSS = `
.trace { display: grid; gap: var(--s-8); }
.trace__back { display: inline-flex; align-items: center; gap: var(--s-1); justify-self: start; min-height: 44px; color: var(--ink-2); font-size: var(--fs-sm); font-weight: 500; text-decoration: none; }
.trace__back:hover { color: var(--ink); text-decoration: underline; }
.trace__title--dim { color: var(--ink-3); font-weight: 400; }
.trace__counts { font-variant-numeric: tabular-nums; }
.trace__title { overflow-wrap: anywhere; }
.trace__prompt summary, .tl__args summary, .cand__desc summary { min-height: 44px; min-width: 44px; display: flex; align-items: center; cursor: pointer; color: var(--accent); }
.trace__prompt summary::before, .tl__args summary::before, .cand__desc summary::before { content: "+"; margin-inline-end: var(--s-2); }
.trace__prompt[open] summary::before, .tl__args[open] summary::before, .cand__desc[open] summary::before { content: "−"; }
.tl__args { min-width: 0; width: 100%; }
.tl__args pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); }
.trace .foldbtn { min-width: 44px; }
/* Console: the event sequence beside a 260px source/session inspector; one column with the inspector first under 960px. */
.trace__console { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--s-8); }
.trace__events { grid-column: 1; display: grid; gap: var(--s-6); align-content: start; min-width: 0; }
.trace__inspector { grid-column: 2; grid-row: 1; display: grid; gap: var(--s-6); align-content: start; min-width: 0; padding-inline-start: var(--s-6); border-inline-start: 1px solid var(--line); }
.trace__subtitle { margin: 0; font-size: var(--fs-section); font-weight: 600; line-height: 1.4; letter-spacing: 0; }
.trace__inspector .trace__subtitle { font-size: var(--fs-subhead); }
.trace__meta { display: grid; gap: var(--s-4); margin: 0; }
.trace__meta > div { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.trace__meta dt { color: var(--ink-2); font-size: var(--fs-cap); }
.trace__meta dd { margin: 0; color: var(--ink); font-size: var(--fs-body); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.trace__dim { color: var(--ink-3); }
.trace__id { font-family: var(--font-mono); font-size: var(--fs-cap); color: var(--ink-2); }
.trace__scope { display: grid; gap: var(--s-2); padding-top: var(--s-6); border-top: 1px solid var(--line); }
.trace__scope-title { margin: 0; font-size: var(--fs-body); font-weight: 600; line-height: 1.5; }
.trace__note { margin: 0; color: var(--ink-2); font-size: var(--fs-cap); line-height: 1.65; text-wrap: pretty; }
.empty--trace .btn { text-decoration: none; }
/* Search and load requests: the shared component keeps its card class, the trace shows it flat behind a rule. */
.trace .request-details { margin: 0; padding: var(--s-6) 0 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; overflow-x: auto; }
.trace .request-details h2 { margin: 0 0 var(--s-2); font-size: var(--fs-section); font-weight: 600; line-height: 1.4; letter-spacing: 0; }
.trace .request-details > .dim { margin: 0 0 var(--s-4); }
.trace .request-details th { color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; }
.trace .request-details th, .trace .request-details td { padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line); }
.trace .request-details :is(th, td):first-child { padding-inline-start: 0; }
.trace .request-details :is(th, td):last-child { padding-inline-end: 0; }
.trace .request-details .btn { margin-top: var(--s-4); }
/* Event rows: time | content | state, hairline rules, no rail. The head is display: contents so its children take grid cells. */
.tl { list-style: none; margin: 0; padding: 0; }
.tl__step { display: grid; grid-template-columns: 82px minmax(0, 1fr) 116px; grid-auto-flow: row dense; column-gap: var(--s-4); row-gap: var(--s-1); padding: var(--s-4) 0; border-bottom: 1px solid var(--line); }
.tl__head { display: contents; }
.tl__dot { display: none; }
.tl__time { grid-column: 1; grid-row: 1; display: grid; align-content: start; gap: var(--s-1); padding-top: var(--s-1); color: var(--ink-3); font-family: var(--font-mono); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; line-height: 1.5; white-space: nowrap; }
.tl__time b { color: var(--ink-2); font-weight: 500; }
.tl__kind { grid-column: 2; grid-row: 1; color: var(--ink); font-size: var(--fs-subhead); font-weight: 600; line-height: 1.5; }
.tl__head > .tl__name { grid-column: 2; }
.tl__tag { grid-column: 3; align-self: start; padding-top: var(--s-1); color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; line-height: 1.5; }
.tl__tag--bad { color: var(--bad); }
.tl__body { grid-column: 2; min-width: 0; color: var(--ink-2); font-size: var(--fs-cap); }
.tl__body:empty { display: none; }
.tl__body > :first-child { margin-top: 0; }
.tl__step--span .tl__body { display: grid; gap: var(--s-1); }
.tl__text { margin: 0; color: var(--ink); font-size: var(--fs-body); white-space: pre-wrap; }
.tl__dim { margin: 0; color: var(--ink-3); }
.tl__line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-2); margin: 0; }
.tl__name { color: var(--ink); font-size: var(--fs-body); font-weight: 500; }
.tl__name--mono { font-family: var(--font-mono); font-size: var(--fs-cap); }
.tl__uri, .tl__digest, .tl__id, .tl__code { font-family: var(--font-mono); font-size: var(--fs-cap); color: var(--ink-3); overflow-wrap: anywhere; }
.tl__code { color: var(--bad); font-weight: 500; }
.tl__errmsg { color: var(--ink-2); }
.tl__meta { margin: 0; color: var(--ink-3); font-size: var(--fs-cap); }
.tl__meta--row { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); }
.tl__mode { color: var(--ink-2); font-weight: 500; }
.tl__query { margin: var(--s-2) 0 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface); color: var(--ink); font-size: var(--fs-body); }
.tl__abstain { display: grid; gap: var(--s-2); margin-top: var(--s-2); padding: var(--s-3) var(--s-4); border-radius: var(--r-sm); background: var(--surface); }
.tl__abstain-head { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.tl__hint { margin: 0; color: var(--ink-2); font-size: var(--fs-body); }
.tl__save { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.tl__save .btn[disabled] { cursor: default; color: var(--ink-2); }
.tl__save .btn[data-save-eval="saved"] { color: var(--ok); }
.tl__err { color: var(--bad); font-size: var(--fs-cap); }
.cands { display: grid; gap: var(--s-1); list-style: none; margin: var(--s-2) 0 0; padding: 0; }
.cands__none { margin: var(--s-2) 0 0; color: var(--ink-3); font-size: var(--fs-cap); }
.cands__legend { margin: var(--s-2) 0 0; color: var(--ink-3); font-size: var(--fs-cap); }
.cands__legend + .cands { margin-top: var(--s-1); }
.cand { display: grid; grid-template-columns: var(--s-5) minmax(0, 11rem) auto minmax(4rem, 1fr) 2.6em 4.6em var(--s-5); grid-template-areas: "rank name inv bar score cov pick" "rank desc desc desc desc desc desc"; align-items: center; column-gap: var(--s-2); padding: var(--s-2); border-radius: var(--r-sm); font-size: var(--fs-sm); }
.cand--chosen { background: var(--wash); }
.cand__rank { grid-area: rank; align-self: start; color: var(--ink-3); font-size: var(--fs-cap); line-height: 1.6; font-variant-numeric: tabular-nums; text-align: right; }
.cand__name { grid-area: name; display: flex; align-items: baseline; gap: var(--s-1); min-width: 0; color: var(--ink); font-weight: 500; }
.cand__nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cand__root { flex: none; color: var(--ink-3); font: 500 var(--fs-micro) / 1 var(--font-mono); letter-spacing: 0; }
.cand__cov { grid-area: cov; color: var(--ink-3); font-size: var(--fs-cap); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cand__inv { grid-area: inv; display: inline-flex; align-items: center; min-height: 26px; padding: 0 var(--s-2); border: 1px solid var(--line); border-radius: 0; background: var(--surface-2); color: var(--ink-2); font: 500 var(--fs-micro) / 1 var(--font-mono); letter-spacing: 0; }
.cand__bar { grid-area: bar; display: block; height: 6px; border-radius: var(--r-full); background: var(--wash-2); overflow: hidden; }
.cand__fill { display: block; height: 100%; border-radius: inherit; background: color-mix(in srgb, var(--ink) 35%, transparent); }
.cand--chosen .cand__fill { background: var(--ok); }
.cand__score { grid-area: score; color: var(--ink); font-size: var(--fs-cap); font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; }
.cand__pick { grid-area: pick; display: grid; place-items: center; width: var(--s-5); height: var(--s-5); color: var(--ok); }
.cand__desc { grid-area: desc; min-width: 0; color: var(--ink-3); font-size: var(--fs-cap); white-space: normal; overflow-wrap: anywhere; }
.cand__matched { color: var(--ink-2); }
@media (max-width: 959.98px) {
  .trace__console { grid-template-columns: minmax(0, 1fr); }
  .trace__inspector, .trace__events { grid-column: 1; }
  .trace__inspector { grid-row: auto; padding-inline-start: 0; border-inline-start: 0; padding-top: var(--s-6); border-top: 1px solid var(--line); }
  .trace__meta { display: flex; flex-wrap: wrap; gap: var(--s-3) var(--s-6); }
}
@media (max-width: 639.98px) {
  .trace .request-details table, .trace .request-details tbody { display: block; }
  .trace .request-details thead { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .trace .request-details tbody tr { display: grid; gap: var(--s-3); padding: var(--s-4) 0; border-bottom: 1px solid var(--line); }
  .trace .request-details td { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-3); padding: 0; border: 0; text-align: left; overflow-wrap: anywhere; }
  .trace .request-details td::before { content: attr(data-label); color: var(--ink-2); font-size: var(--fs-cap); font-weight: 500; overflow-wrap: normal; }
  .trace .request-details td > .badge { justify-self: start; }
  .tl__step { grid-template-columns: 72px minmax(0, 1fr); column-gap: var(--s-3); }
  .tl__tag { grid-column: 2; padding-top: 0; }
  .cand { grid-template-columns: var(--s-5) minmax(0, 1fr) auto 2.6em var(--s-5); grid-template-areas: "rank name inv score pick" "rank bar bar cov cov" "rank desc desc desc desc"; row-gap: var(--s-1); }
  .cand__cov { text-align: right; }
  .cand__desc { white-space: normal; }
}
`;
