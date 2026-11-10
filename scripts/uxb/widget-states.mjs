export const widgetStates=[
 "Card","Metric","Bar","Line","Histogram","Chart-unmeasured","Chart-empty",
 "Line-unmeasured","Histogram-unmeasured","Bar-empty","Histogram-empty",
 ...["ready","loading","empty","error"].map(state=>`Widget-${state}`),
 "Empty","Empty-intro",
 ...["default","info","warning","destructive"].flatMap(variant=>["default","sm"].map(size=>`Alert-${variant}-${size}`)),
 ...["DEFAULT","DEBUG","WARNING","ERROR"].flatMap(level=>["default","compact"].map(size=>`StatusMessage-${level}-${size}`)),
 ...["info","warning"].flatMap(variant=>["top","middle"].map(align=>`Callout-${variant}-${align}`)),
 "Metric-zero","Metric-unmeasured",
 "Card-minimal","Metric-affixes","Metric-strip-empty","Empty-minimal","Alert-body-only","Alert-icon-only","Alert-action","Alert-dismissible",
 "Callout-no-actions","Callout-links","Callout-disabled","Widget-empty-no-action","Widget-error-no-action",
 "StatusMessage-announced-status","StatusMessage-announced-error",
];

export function assertWidgetStates(actual) {
 const missing=widgetStates.filter(state=>!actual.includes(state));
 const unexpected=actual.filter(state=>!widgetStates.includes(state));
 if(missing.length||unexpected.length||new Set(actual).size!==actual.length)
  throw new Error(`Incomplete widget states: ${JSON.stringify({missing,unexpected,duplicates:actual.length-new Set(actual).size})}`);
}

export const conditionalParts={
 "Card":{present:[".lf-card__description",".lf-card__actions .lf-button",".lf-card__footer"],absent:[]},
 "Widget-ready":{present:[".lf-card__content"],absent:[".lf-skeleton",".lf-empty",".lf-alert"]},
 "Widget-loading":{present:[".lf-skeleton"],absent:[".lf-empty",".lf-alert"]},
 "Widget-empty":{present:[".lf-empty__action .lf-button"],absent:[".lf-alert"]},
 "Widget-error":{present:['.lf-alert[role="alert"] .lf-button'],absent:[".lf-empty"]},
 "Empty":{present:[".lf-empty__description",".lf-empty__action .lf-button"],absent:[]},
 "Card-minimal":{present:[".lf-card__title",".lf-card__content"],absent:[".lf-card__description",".lf-card__actions",".lf-card__footer"]},
 "Metric-affixes":{present:[".lf-metric__value",".lf-metric__note"],absent:[]},
 "Metric-strip-empty":{present:[".lf-metric-strip"],absent:[".lf-metric"]},
 "Empty-minimal":{present:[".lf-empty__title"],absent:[".lf-empty__description",".lf-empty__action"]},
 "Alert-body-only":{present:[".lf-alert__description"],absent:[".lf-alert__title",".lf-alert__icon",".lf-message-actions"]},
 "Alert-icon-only":{present:[".lf-alert__icon",".lf-alert__description"],absent:[".lf-alert__title",".lf-message-actions"]},
 "Alert-action":{present:[".lf-message-actions .lf-button"],absent:[]},
 "Alert-dismissible":{present:[".lf-message-actions .lf-icon-button"],absent:[]},
 "Callout-no-actions":{present:[".lf-icon-button"],absent:[".lf-message-actions"]},
 "Callout-links":{present:['a[href="#gallery"]','a[target="_blank"][rel="noopener noreferrer"]'],absent:[".lf-message-actions button"]},
 "Callout-disabled":{present:[".lf-message-actions button:disabled",".lf-icon-button"],absent:[]},
 "Widget-empty-no-action":{present:[".lf-empty"],absent:[".lf-empty__action"]},
 "Widget-error-no-action":{present:[".lf-alert"],absent:[".lf-message-actions"]},
 "StatusMessage-announced-status":{present:['.lf-status-message[role="status"]'],absent:[]},
 "StatusMessage-announced-error":{present:['.lf-status-message[role="alert"]'],absent:[]},
 ...Object.fromEntries(["Chart-unmeasured","Chart-empty","Line-unmeasured","Histogram-unmeasured","Bar-empty","Histogram-empty"]
  .map(state=>[state,{present:[".lf-empty","table","summary"],absent:[".lf-chart__scroll","[data-chart-point]"]}])),
 ...Object.fromEntries(["info","warning"].flatMap(variant=>["top","middle"].map(align=>
  [`Callout-${variant}-${align}`,{present:[".lf-message-actions .lf-button",".lf-icon-button"],absent:[]}]))),
};
