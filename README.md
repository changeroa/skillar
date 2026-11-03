# Skillar Prompt / Vermilion branding evidence

Baseline: main `720222f`. Branding: `4b819ce`.

`comparisons/` contains before/after pairs for the same seven views: home,
account, MCP setup, and dashboard Sessions, Workspaces, Flow, Heatmap. Each
has light/dark captures at 390 CSS px (DPR 3, touch), 1440px, and 1920px.
PNG width was checked against CSS viewport width times DPR after navigation.
The complete top/full/end raw matrices are retained in the lane's local
evidence; this branch publishes the readable paired comparisons.

`assets/` contains the finalized Prompt brand exports, brand sheet and
native-size contact/pixel sheets. `checks.md` records verification and limits.

The account pages are captured on a static production preview, where the
existing unavailable-auth-service message is expected. No personal account
data is present. This branch hosts review images only, separate from the
minimal site implementation branch.
