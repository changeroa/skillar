# P8 visual evidence

This dedicated branch contains review images, not application source.
The refreshed candidate images correspond to application commit
`623c5a4906575dad027a77acaf5fc641a21e2c26` (PR #59). Anonymous P7 before images
are unchanged.

- `before/`: the existing P7 production site at `https://skillar.sh/dashboard/`,
  captured anonymously before the P8 deployment.
- `after/`: the P8 candidate build's anonymous dashboard, at the same viewport
  and color theme, served by the loopback QA harness.
- `fixture/`: the candidate's authenticated views and consent controls. Every
  activity record and account shown comes from the repository's synthetic
  in-memory fixtures. No owner's local data, browser session, or credentials
  are included.

The candidate images establish UI behavior, not production activation. The PR
records deployment and post-deployment verification separately.

Phone captures use 390 CSS pixels, DPR 3 and touch emulation (1170 x 2532 PNG).
Desktop captures use 1440 x 900 CSS pixels at DPR 1. Originals are preserved.
The complete private QA packet covers 234 states across 390, 1440 and 1920 CSS
pixels, in light and dark themes.

## Anonymous before and after

| View | Before production | After candidate |
| --- | --- | --- |
| Phone, light | ![Before phone light](before/iphone-14-light-dashboard.png) | ![After phone light](after/iphone-14-light-signed-out.png) |
| Phone, dark | ![Before phone dark](before/iphone-14-dark-dashboard.png) | ![After phone dark](after/iphone-14-dark-signed-out.png) |
| Desktop, light | ![Before desktop light](before/desktop-1440-light-dashboard.png) | ![After desktop light](after/desktop-1440-light-signed-out.png) |
| Desktop, dark | ![Before desktop dark](before/desktop-1440-dark-dashboard.png) | ![After desktop dark](after/desktop-1440-dark-signed-out.png) |

## Synthetic authenticated fixtures

![Session trace on phone](fixture/iphone-14-light-trace-start.png)

![Flow on phone in dark theme](fixture/iphone-14-dark-flow-start.png)

![Heatmap on phone in dark theme](fixture/iphone-14-dark-heatmap-start.png)

![Workspace detail on desktop](fixture/desktop-1440-light-workspace-start.png)

Selecting managed content for a new device still leaves every content category
unchecked until the user explicitly chooses it:

![New managed consent with no content selected](fixture/iphone-14-light-new-device-managed-unchecked.png)
