const skill = "11223344-1122-4122-8122-000000000002";
const documentRoute = `/skills/?skill=${skill}&view=full&tab=document`;
export const P1_SURFACES = [
  { name: "home", route: "/dashboard/", ready: ".home-changes rect" },
  { name: "skills", route: "/skills/", ready: "tr[id^=skill-row-]" },
  { name: "document", route: documentRoute, ready: ".skill-document-preview" },
  { name: "document-raw", route: documentRoute, ready: ".skill-document-preview", action: "raw" },
  { name: "document-editor", route: documentRoute, ready: ".skill-document-preview", action: "editor" },
  { name: "versions", route: `/skills/?skill=${skill}&view=full&tab=versions`, ready: ".version-list .version" },
  { name: "compare", route: `/skills/?skill=${skill}&view=full&tab=compare`, ready: ".diff-result" },
  { name: "connections", route: "/connections/", ready: ".connections-grid tbody tr" },
  { name: "account", route: "/login/?auth=signed-in", ready: "#signed-in:not([hidden])", action: "account-avatar" },
  { name: "device-grant", route: "/dashboard/", ready: ".home-changes rect", action: "device-grant" },
  { name: "skill-toast", route: `/skills/?skill=${skill}`, ready: ".skill-peek-actions", action: "skill-toast" },
  { name: "commands", route: "/dashboard/", ready: ".home-changes rect", action: "commands" },
  { name: "commands-eval", route: "/dashboard/", ready: ".home-changes rect", action: "commands-eval" },
  { name: "consent", route: "/dashboard/", ready: ".home-changes rect", action: "consent" },
  { name: "consent-backfill", route: "/dashboard/", ready: ".home-changes rect", action: "consent-backfill" },
  ...["local", "hosted-embed"].flatMap(surface => [
    ...(surface === "local" ? ["sessions", "dashboard", "flow", "workspaces", "heatmap"]
      : ["sessions", "flow", "workspaces", "heatmap"]).map(view => ({
      name: `${surface}-${view}`, surface, view, ready: view === "sessions" ? "[data-session-id]" : ".analysis-toolbar",
    })),
    { name: `${surface}-trace`, surface, view: "trace", ready: ".trace-event-row" },
    { name: `${surface}-attributes`, surface, view: "attributes", ready: ".trace-event-row" },
    { name: `${surface}-tool-args`, surface, view: "tool-args", ready: ".trace-event-row" },
    ...(surface === "local" ? ["dashboard", "flow", "workspaces", "heatmap"]
      : ["flow", "workspaces", "heatmap"]).map(view => ({
      name: `${surface}-${view}-error`, surface, view, ready: ".analysis-toolbar", error: true,
      scenario: surface === "local" ? `${({ dashboard: "stats", flow: "flow", workspaces: "workspaces", heatmap: "heatmap" })[view]}:failed`
        : "report:failed",
    })),
  ]),
];
