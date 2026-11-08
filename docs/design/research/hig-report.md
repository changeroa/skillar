<!-- Portable copy of the lane research report `hig.md`. Source SHA-256 2529ff285b51f24c7d95c85f2de22350d929e0620821e75287730cc1c1d9c1bd, 43600 bytes. Temporary extraction-cache paths were replaced with a generic description; the source had no private home paths and no other text changed. -->

# Apple HIG research for skillar web screens

Product: developer skill registry and MCP landing, then a screen-only login, then connecting an account MCP, then a remote dashboard shell. There's no backend, and no metrics or prices may be invented.
Researched: 2026-11-02. Read-only research; no product files touched.
Citation format: `[slug]` means `https://developer.apple.com/design/human-interface-guidelines/<slug>`.

## 0. Method and source manifest

- **How pages were fetched.** HIG pages are rendered with JavaScript, so content came from Apple's own DocC JSON: `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json` (HTTP 200).
- **How groups were enumerated.** The index JSON and the group JSONs (foundations, patterns, components and its 8 subgroups, inputs, technologies, getting-started) were read to list every child page.
- **How text was extracted.** For each page, the abstract plus `primaryContentSections` (paragraphs, headings, list items) were flattened to text. The cache was a temporary extraction cache (not preserved) (6,070 lines, 438,476 bytes).
- **What "read in full" means here.** All 6,070 lines were read end to end, including the platform sections, for every page marked F below.
- **Known extraction loss, first pass (the 55 F pages).** Tables, images, and inline cross-reference link text were dropped. Concrete examples:
  - The WCAG contrast table in `accessibility`
  - The Dynamic Type and minimum-size tables in `typography`
  - The standard keyboard shortcut table in `keyboards`
  - The system color values in `color`
  - The Sign in with Apple minimum-size table

  Where a rule depends on a table, this report quotes only the prose numbers that survived. Those are 4.5:1 and 7:1 contrast [dark-mode], 44x44 pt hit regions [buttons], padding of about 12 pt with a bezel and 24 pt without one [accessibility, pointing-devices], text enlargement of at least 200% [accessibility], tooltip length of 60 to 75 characters [offering-help], and toolbar titles under 15 characters [toolbars].
- **Read in full (F), 55 pages:** design-principles, accessibility, branding, color, dark-mode, icons, images, inclusion, layout, motion, privacy, typography, writing, charting-data, entering-data, feedback, launching, loading, managing-accounts, modality, offering-help, onboarding, searching, settings, undo-and-redo, buttons, text-fields, sidebars, tab-bars, toolbars, alerts, sheets, progress-indicators, lists-and-tables, menus, popovers, search-fields, labels, toggles, segmented-controls, boxes, collections, activity-views, focus-and-selection, keyboards, pointing-devices, sign-in-with-apple, materials, right-to-left, pop-up-buttons, combo-boxes, disclosure-controls, windows, scroll-views, split-views.
- **Unavailable (404):** `links` and `tooltips`. They aren't HIG slugs. Tooltip guidance was found in the macOS/visionOS section of `offering-help`.
- **Second pass, 45 pages (status F2).** The same JSON endpoint was used, all HTTP 200, with a table-aware extractor. DocC `table` nodes were kept as pipe rows, and list items were kept. Images and videos became `[IMAGE omitted]` or `[VIDEO omitted]` markers, and inline cross-reference link text is still lost (it shows as blank list items or gaps such as "see ."). The cache was a temporary extraction cache (not preserved) (2,770 lines, 246,475 bytes), read end to end.
  - **Tables recovered:** text-size and button-size tables per platform (designing-for-games), the notification interruption-level table (managing-notifications), standard-gesture and macOS trackpad/touch tables (gestures), the action-sheet button-style table, and change logs.
  - **Pages read:** designing-for-ios, -ipados, -macos, -tvos, -visionos, -watchos, -games, -iphone-duo; collaboration-and-sharing, drag-and-drop, file-management, going-full-screen, managing-notifications, multitasking, printing, ratings-and-reviews; charts, text-views, web-views, image-views, token-fields, path-controls, context-menus, pull-down-buttons, edit-menus, tab-views, outline-views, column-views, lockups, panels, action-sheets, page-controls, pickers, sliders, steppers, digit-entry-views, color-wells, image-wells, gauges, rating-indicators, notifications, status-bars; gestures; generative-ai, voiceover.
- **Third pass, 58 pages (status F3).** These are the platform-only and Apple-technology pages that were previously excluded by title. They were fetched from the same JSON endpoint (all HTTP 200) with the table-aware extractor, cached at a temporary extraction cache (not preserved) (646,445 bytes, split into rest-1 to rest-4), and read end to end. Each was then judged against an ordinary responsive web app, and the verdict is recorded in section 1. `siri` was found missing from the earlier technology list and was added here.
- **Table re-extraction for the first 55 pages.** Tables were pulled again from the JSON for all 55 first-pass pages and cached at a temporary extraction cache (not preserved) (65,499 bytes; 53,012 bytes once change-log tables are removed), then read in full. 44 of the pages contain tables. Numbers verified:
  - **Contrast** [accessibility]: text up to 17 pt needs at least 4.5:1; text at 18 pt or larger needs 3:1; bold text at any size needs 3:1. These are Apple's pt values for native platforms, and they aren't the WCAG web thresholds. For the web, WCAG large text is 24 CSS px and up, or 18.66 CSS px and up when bold. skillar requires 4.5:1 for all text regardless (item 59).
  - **Text size** [accessibility, typography]: default/minimum 17/11 pt on iOS and iPadOS, 13/10 pt on macOS. The iOS Dynamic Type Large body size is 17 pt.
  - **Controls** [accessibility]: default/minimum 44x44 / 28x28 pt on iOS and iPadOS, 28x28 / 20x20 pt on macOS.
  - **Keyboards** [keyboards]: the full macOS standard-shortcut table and the modifier-key guidance (prefer Command; avoid Control as a modifier). Esc and Command-Period cancel, which matches the alert cancel table in [alerts].
  - **Privacy purpose strings** [privacy]: a good example is an active sentence that names how and why; passive or bare imperative wording is the bad example.
  - **Images** [images]: vector (SVG or PDF) for interface icons; PNG for raster; JPEG or HEIC for photos.
  - **Sign in with Apple** minimum 140x30 pt (not adopted).
  - Color, label and material tables carry API names and swatch images only, so no values were extractable.
- **Design-contract note.** skillar keeps its **44x44 CSS px minimum** touch target. The HIG's 28 pt platform minimums are recorded as facts, but they don't relax the contract.
- **Images and video are never extracted.** 171 image nodes were counted in the first 55 pages alone, and every page in all three passes rendered images and videos as `[IMAGE omitted]` or `[VIDEO omitted]`. Swatch-only tables (system colors, Live Activity ring colors) and image-only example rows in tables (Do/Don't icons) therefore carry no visual information here.
- **Edit method.** No filesystem `apply_patch` tool was available in this session, so the report was updated with exact-text replacements on this one file only.

## 1. Coverage matrix (every section found)

Status codes:
- **F**: fetched and read in full
- **N**: listed in the index but not fetched
- **X**: listed, not applicable to a web flow (hardware, an Apple-only technology, or a non-web platform)
- **404**: the endpoint returned 404

### Getting started (9)
| Slug | Status | Note |
|---|---|---|
| design-principles | F | Basis for P1 to P4 |
| designing-for-macos, designing-for-ipados | F2 | Desktop web shell analogs. Source of U1 to U3 |
| designing-for-ios | F2 | Mobile-width analog. Source of U4 |
| designing-for-games | F2 | Platform text and button size tables used as numeric anchors (U5). The rest is game-only and N/A |
| designing-for-iphone-duo | F2 | Hardware-specific. Its resize principles carry over (U6); posture and fold rules are N/A |
| designing-for-tvos, -visionos, -watchos | F2 | Read in full. Platform-only, so N/A |

### Foundations (18)
| Slug | Status | Note |
|---|---|---|
| accessibility, branding, color, dark-mode, inclusion, layout, motion, privacy, right-to-left, typography, writing | F | Core sources |
| icons, images, materials | F | Partly applicable: icon consistency, alt text, 1x/2x assets. Liquid Glass and materials are Apple-only, so only the principles were kept |
| app-icons, sf-symbols | F3, N/A | Read. They cover Apple icon assets. What carries over: use one consistent icon set; give every symbol a text alternative; use animated icons only with a clear purpose (V9) |
| immersive-experiences, spatial-layout | F3, N/A | Read. visionOS-only. What carries over: let people choose when immersion starts and give them a clear exit, which maps to never opening full-screen overlays automatically |

### Patterns (25)
| Slug | Status |
|---|---|
| charting-data, entering-data, feedback, launching, loading, managing-accounts, modality, offering-help, onboarding, searching, settings, undo-and-redo | F |
| managing-notifications, multitasking | F2 (U12, U13) |
| collaboration-and-sharing, drag-and-drop, file-management, going-full-screen, printing, ratings-and-reviews | F2. Read; only their general principles apply (U14), the features themselves are out of scope |
| live-viewing-apps, playing-audio, playing-haptics, playing-video, workouts | F3, N/A. Read. What carries over: no autoplay without controls; respect system volume; haptics are optional and never the only signal (V10) |

### Components (8 groups)
| Group | F | F2 (read in second pass) | F3 (read in third pass, N/A for web) |
|---|---|---|---|
| content | | charts, image-views, text-views, web-views | |
| layout-and-organization | boxes, collections, disclosure-controls, labels, lists-and-tables, split-views | tab-views; column-views, outline-views (macOS-only; principles noted); lockups (tvOS-only, N/A) | |
| menus-and-actions | activity-views, buttons, menus, pop-up-buttons, toolbars | context-menus, edit-menus, pull-down-buttons | dock-menus, home-screen-quick-actions, ornaments, the-menu-bar |
| navigation-and-search | search-fields, sidebars, tab-bars | token-fields, path-controls (macOS-only, N/A after reading) | |
| presentation | alerts, popovers, scroll-views, sheets, windows | action-sheets, page-controls; panels (macOS-only, N/A) | |
| selection-and-input | combo-boxes, segmented-controls, text-fields, toggles | pickers, sliders, steppers; digit-entry-views (tvOS), color-wells, image-wells (N/A after reading) | virtual-keyboards |
| status | progress-indicators | gauges, rating-indicators | activity-rings |
| system-experiences | | notifications; status-bars (native status bar, N/A for web) | app-shortcuts, complications, controls, live-activities, snippets, top-shelf, watch-faces, widgets |

### Inputs (13)
| Slug | Status |
|---|---|
| focus-and-selection, keyboards, pointing-devices | F |
| gestures | F2 (U7). Gesture tables recovered; visionOS and watchOS parts are N/A |
| action-button, apple-pencil-and-scribble, camera-control, digital-crown, eyes, gyro-and-accelerometer, nearby-interactions, remotes | F3, N/A (hardware inputs) |
| game-controls | F3, N/A. One web-relevant number: touch controls at least 44x44 pt for frequent actions; visible press state (V4) |

### Technologies (29)
| Slug | Status | Note |
|---|---|---|
| sign-in-with-apple | F | **Don't adopt it.** It's Apple-branded and needs a backend. Its general sign-in rules were kept: value before sign-in, minimal data, show sign-in state |
| generative-ai | F2 | U8. Applies to how AI-related skills are described and to any generated content |
| voiceover | F2 | U9. Maps to web headings, landmarks and live regions |
| app-clips, apple-pay, apple-in-app-purchase, machine-learning, siri, mac-catalyst, wallet, tap-to-pay-on-iphone, augmented-reality, nfc | F3. Apple technology, so N/A as features | Read. Their universal writing, error and transparency rules are kept as V1 to V8 |
| airplay, always-on, carekit, carplay, game-center, healthkit, homekit, icloud, id-verifier, imessage-apps-and-stickers, live-photos, maps, photo-editing, researchkit, shareplay, shazamkit | F3, N/A | Read. Platform or Apple-technology specific; nothing beyond rules already listed |

### Unavailable
`links`, `tooltips`: 404.

**Coverage statement.** All 158 enumerated content pages were fetched and read in full: 55 in the first pass (F), 45 in the second (F2) and 58 in the third (F3). No page is excluded by title any more. Every N/A verdict was made after reading the page. 2 slugs (`links`, `tooltips`) returned 404. Tables for the first 55 pages were re-extracted and read. **Not covered, on any page:** image and video content, and the text of inline cross-reference links.

## 2. Universal principles (Apple branding removed), each tied to skillar

| # | Principle (HIG wording, paraphrased) | Source | How it applies to skillar |
|---|---|---|---|
| P1 | Create value; keep focused; stay out of the way | design-principles | The landing page does one job: find a skill, then connect the MCP |
| P2 | Freedom to explore; guided flows can be skipped or escaped; help people recover from mistakes | design-principles | Every connect step can be left; the registry can be browsed without logging in |
| P3 | Be fully transparent about what the product does and why; collect only what's needed | design-principles, privacy | Label the login and the dashboard as screen-only demos. Show no invented data |
| P4 | Familiar, consistent visuals and interactions; clear feedback | design-principles, branding | Use standard web controls (native buttons, inputs, `<dialog>`) and keep them consistent across the three screens |
| P5 | Ask for an account only if core features need it; delay sign-in; explain the benefit in the sign-in view; name the authentication method on the button ("Sign In with X", not just "Sign In") | managing-accounts, sign-in-with-apple | Login appears at "Connect account", not on the landing page. The button names the method |
| P6 | Never prefill a password; use secure fields; avoid custom authentication schemes; prefer passkeys or 2FA | entering-data, privacy, managing-accounts | A screen-only login must not pretend to authenticate or keep credentials |
| P7 | Request access only when it's needed, with a specific, plain purpose sentence. The single-button ("Continue"/"Next", not "Allow") rule is written for custom screens shown **before an OS permission alert** | privacy | The universal part is the plain purpose sentence. skillar's MCP registration is an explanatory screen, not an OS pre-permission, so the single-Continue rule **does not apply** (see section 6) |
| P8 | Get data from the system, prefill sensible defaults, prefer choices over typing, allow paste | entering-data | Universal for any form that exists. Prefilled endpoints, client pickers and token paste aren't in the screen-only scope; they're examples only (section 6) |
| P9 | A persistent label plus a hint; validate dynamically (email when focus leaves the field; username and password before leaving); disable Next until required data is present | text-fields, entering-data | Applies to the login and connect forms |
| P10 | Show something as soon as possible; placeholders while loading; let people act while content loads | loading, launching | The shell renders first, with skeletons in panels and navigation usable at once |
| P11 | Prefer determinate progress; keep it moving; avoid vague "Loading"/"Authenticating" labels; Cancel when stopping is safe; switch from indeterminate to determinate when you can | progress-indicators | Connect shows "Step 2 of 3: Verifying endpoint" with a Cancel button |
| P12 | Feedback matches importance, sits near its item, uses several channels, and says why a command failed | feedback | Inline connection status (icon, text and color) with a reason |
| P13 | Use alerts rarely: never on launch, never just to inform, never for common undoable actions; specific button titles, not "OK"; "Cancel" is never the default; destructive style only for actions people didn't choose | alerts, feedback | Only "Disconnect account" gets a confirmation. Startup problems appear as an inline label |
| P14 | Errors appear near the problem, don't blame, say how to fix, no "oops", no "we" | writing | "Unable to reach MCP server. Check the URL, then retry." |
| P15 | Empty screens give a clear next step plus a button, and don't hold crucial information | writing | An empty dashboard panel says "No skills connected yet" and offers "Browse registry" |
| P16 | Active voice; verb labels; no "Click here"; consistent flow labels (Get Started, Continue/Next, Done); one capitalization style per element type | writing, buttons, menus | Applies to every call to action and link |
| P17 | Order by importance (top, leading side); align and indent to show hierarchy; group related items; progressive disclosure | layout, disclosure-controls | Primary call to action at the top leading side; advanced connection options behind a disclosure |
| P18 | Same functions at every size; adapt the layout, not the features; prepare for text resizing (stack, grow rows) | layout, typography | Mobile and desktop have identical capabilities; layout survives 200% zoom |
| P19 | Legible sizes; no Ultralight, Thin or Light weights; few typefaces; minimal truncation at large sizes | typography | Applies to body text and table cells |
| P20 | Contrast at least 4.5:1, aiming for 7:1 on small custom text; test light, dark and high contrast | dark-mode, accessibility, color | Applies to all text tokens in both themes |
| P21 | One color means one thing; never color alone; check cultural meaning | color, accessibility, toggles | Status pills combine an icon and a word |
| P22 | Follow the system theme; the HIG discourages an app-only appearance setting; respect global settings | dark-mode, settings | Default to `prefers-color-scheme` and honor `prefers-contrast`. skillar's existing theme override is a required web feature and stays. This is an applicability limit, not a violation (section 6) |
| P23 | Purposeful, brief motion that's optional and can be cancelled; with Reduce Motion, swap moves for fades, avoid zoom, blur and bounce | motion, accessibility | Use `prefers-reduced-motion` |
| P24 | Hit targets 44x44 pt; spacing of about 12 pt with a bezel, 24 pt without; a pressed state on every custom button | buttons, accessibility, pointing-devices | Map 44 pt to 44 CSS px (my interpretation) |
| P25 | One or two prominent buttons per view; distinguish by style, not size; the primary role is never destructive | buttons, toolbars | One accent-filled call to action per screen |
| P26 | Full keyboard access; don't override standard shortcuts; never move focus without user action; tab order follows reading order; focus ring on fields, highlight on list rows | keyboards, focus-and-selection, text-fields, accessibility | Login, connect and dashboard navigation work with the keyboard alone |
| P27 | No auto-dismissing timed UI; dismiss explicitly | accessibility | Toasts stay until dismissed or are mirrored inline |
| P28 | Every non-text control has an accessible label; charts have accessibility labels and summaries | icons, charting-data, accessibility | Icon buttons have `aria-label` |
| P29 | Use a modal only when it clearly helps; keep it short with one path; title it with its task; obvious dismissal; confirm before losing data; one modal at a time | modality, sheets, popovers | The connect flow is a single titled dialog |
| P30 | Done is paired with Cancel or Back, never all three; Cancel discards, and is the only thing that does | sheets, popovers | Connect dialog buttons |
| P31 | The sidebar is for top-level navigation; at most 2 levels; can be hidden but isn't hidden by default; nothing critical at its bottom; collapses to compact navigation when narrow | sidebars, split-views, tab-bars | Dashboard shell |
| P32 | Navigation controls stay visible; don't hide or disable navigation items when empty, explain the emptiness instead | tab-bars | Dashboard sections with nothing in them stay visible with an empty state |
| P33 | Useful view titles (not the app name, under 15 characters); one primary action on the trailing side; at most 3 groups | toolbars | Dashboard header |
| P34 | Search is prominent when important; one location; scope shown in the placeholder; results appear while typing; history can be cleared | searching, search-fields | Registry search |
| P35 | Text lists go in a list or table, images in a collection; descriptive column headings; selection is highlighted persistently in navigation | lists-and-tables, collections, split-views | Skill list as a table or list |
| P36 | Use a chart only when it highlights real insight; otherwise use a list or table | charting-data | No decorative charts without data |
| P37 | Brand defers to content; accent color sparingly; no repeated logos; no splash or launch screen used as branding | branding, launching | Logo appears once, in the header |
| P38 | Onboarding is fast, optional and interactive; prefer contextual tips (1 to 2 sentences, at most 3 steps, not promotional); don't show again once skipped | onboarding, offering-help | Tip next to "Connect MCP" |
| P39 | Restore previous state and scroll position | launching, settings | Last panel stored client-side |
| P40 | Plain, inclusive language; "you" not "the user"; define jargon (for example "MCP"); no humor or idioms in critical copy; gender-neutral figures | inclusion, writing | Define "MCP" on first use on the landing page |
| P41 | Right-to-left: mirror the layout and back/next direction; never flip logos, numbers or real-world icons | right-to-left, layout | Use logical CSS properties |
| P42 | Let people select error and technical text (IDs, URLs) | labels | Endpoint and error text are selectable and copyable |
| P43 | No nested scroll areas in the same direction; make it clear content can scroll | scroll-views | Dashboard panels |
| P44 | Undo instead of confirmation for reversible actions; show what was undone | undo-and-redo, alerts | Removing a skill offers undo |
| P45 | Settings are minimal; options for a task sit in that task; give a direct link to a setting rather than describing where it is | settings, writing | No settings page in this scope |

### 2b. Universal findings from the second pass (F2)

| # | Principle | Source | How it applies to skillar |
|---|---|---|---|
| U1 | On large displays, show more content in fewer nested levels and with less modality, at a comfortable density | designing-for-macos | The dashboard shell prefers inline panels to stacked dialogs |
| U2 | Support keyboard shortcuts and keyboard-only work; let people resize and personalize; touch on desktop gets bigger targets without changing control size or density | designing-for-macos, gestures | Desktop shell is fully keyboard-operable. Enlarge hit areas with padding, not by redrawing controls |
| U3 | Minimize modal and full-screen transitions; size and density follow viewing distance and input mode | designing-for-ipados | Tablet widths keep the desktop density, not a phone layout |
| U4 | Limit onscreen controls and keep secondary actions discoverable; put frequent controls where they're easy to reach | designing-for-ios | At 390px the primary call to action sits within thumb reach |
| U5 | Numeric anchors from the recovered table: default and minimum text 17/11 pt (iOS), 13/10 pt (macOS); buttons 44x44 default and 28x28 minimum (iOS), 28x28 and 20x20 (macOS) | designing-for-games | Body text at least 16 CSS px on mobile; no interactive target under 28 px even on desktop (mapping to px is my interpretation) |
| U6 | Build to resize: same functions at every size; small adjustments rather than dramatic rearrangement; controls near the content they affect; one overflow menu; give every icon item a title | designing-for-iphone-duo | Responsive breakpoints never drop features or reshuffle the navigation order |
| U7 | More than one way to act; indicate when an action isn't available and why; never repurpose standard gestures; custom gestures are never the only path | gestures | Disabled controls look distinct and explain why. Swipe, if any, always has a button equivalent |
| U8 | Disclose where AI is used and never pass AI output off as human; set expectations about capabilities and limits; keep people in control (edit, undo, retry); specific progress text, not "Processing..."; avoid presenting unverified facts | generative-ai | Skill descriptions that mention AI say so plainly. No generated testimonials, usage counts or claims |
| U9 | Unique page titles and accurate headings; group related elements; announce visible content changes; hide decorative images; describe meaningful ones | voiceover | Each screen has a unique `<title>` and `<h1>`; landmarks; `aria-live` for status changes; decorative art gets `alt=""` |
| U10 | A context menu holds only frequent, relevant items, always duplicated in the main UI, with at most about 3 groups; hide unavailable items; destructive items go last. A pull-down button needs at least 3 items and never hides a view's primary actions | context-menus, pull-down-buttons | Any "More" menu duplicates visible actions and lists Disconnect last |
| U11 | Use a chart only to state a main message; summarize it in text; never require interaction to reveal critical information; no color-only series; prefer common chart types and familiar axis ticks | charts | No charts at all in this scope, because there's no real data |
| U12 | Badges and counts only reflect real unread items; never mimic a badge; no marketing messages without opt-in; errors go in an alert or inline, not a notification; no sensitive data in a notice | notifications, managing-notifications | The dashboard shell shows no fake badges or unread counts |
| U13 | Preserve and restore context when people switch away; adapt gracefully to any window size | multitasking | Switching tabs or resizing the window never loses form input |
| U14 | Offer alternatives to drag and drop; autosave instead of explicit save; hide actions that can't run (Print); never ask for ratings on first use; summarize sharing permissions in a short phrase; leave full screen under the person's control | drag-and-drop, file-management, printing, ratings-and-reviews, collaboration-and-sharing, going-full-screen | Only relevant if these features are added later. No ratings or stars are shown now |
| U15 | Tab views: at most about 6 tabs, noun labels, controls affect only their own pane. Page controls: ordered pages only, at most about 10 dots | tab-views, page-controls | Any tabbed panel in the shell follows these limits |
| U16 | Make useful text selectable (errors, IDs, URLs); use a text view for long text; text over images needs contrast or a backing layer | text-views, edit-menus, image-views | Hero text over artwork has a scrim. Error and endpoint text can be copied |
| U17 | Web content in an app: offer back/forward when it spans several pages; don't rebuild a browser | web-views | Embedded docs, if any, get back/forward controls |
| U18 | Gauges and rating indicators label the current value and both ends of the range, and only show real values | gauges, rating-indicators | No gauges or star ratings without backing data |

### 2c. Universal findings from the third pass (F3)

| # | Principle | Source | How it applies to skillar |
|---|---|---|---|
| V1 | Don't require account creation before people get value; ask after a task, and only for the minimum. Never use a web view to stand in for real UI | app-clips | Reinforces P5. The landing page works without login |
| V2 | Never hide or disable the primary action button. If something is missing, say so after the click and move focus to the field that needs fixing. Error copy names the field and what's expected, in a noun phrase of about 128 characters or fewer. Be lenient with input formats | apple-pay | Login and connect submit buttons stay enabled, or show why they're disabled (this refines item 10). Errors read like "Email address is missing an @" |
| V3 | Show the total price; make cancelling easy; no ads or promotion inside status surfaces | apple-in-app-purchase, live-activities, top-shelf | No prices are shown at all (product rule); no promotional banners in the dashboard shell |
| V4 | Touch controls: frequent actions at least 44x44 pt, secondary ones at least 28x28 pt; always a visible press state | game-controls | skillar uses 44 px for every target (design contract) |
| V5 | Explain AI or ML results with factual attribution ("Because you…"); avoid jargon and raw confidence percentages; feedback is voluntary and acted on at once; corrections are easy | machine-learning | If skill recommendations ever appear, they carry a factual reason and no percentages |
| V6 | Responses are clear, succinct and device-independent; errors are specific ("out of chicken noodle soup", not "can't complete"); no advertising; inclusive wording | siri | Matches P14 and P40 |
| V7 | Use friendly terms instead of technical ones (AR: "surface", not "plane"; NFC: "scan", not "NFC tag") | augmented-reality, nfc | Define or replace developer jargon such as "MCP transport" in user-facing copy (refines P40) |
| V8 | Offer Next and Previous buttons as well as swipe gestures; reflect the hierarchy top-down; put the most important actions near the top of the window | mac-catalyst | Desktop shell keeps the primary actions at the top; paging, if any, has buttons |
| V9 | Text alternatives for icons; one consistent icon style; animated icons only with a clear purpose | sf-symbols, app-icons | Same as P28 and P23 |
| V10 | Audio and video never autoplay without controls; haptics are optional and never the only signal | playing-audio, playing-video, playing-haptics | No autoplay media on the landing page |
| V11 | Widgets and glanceable surfaces: text 11 pt minimum; placeholder content uses neutral shapes, not fake data; previews use realistic simulated data only when clearly representative | widgets | Dashboard skeletons use neutral blocks and never fake numbers (refines P10 and item 3) |
| V12 | Privacy and safety: ask for sensitive data only at the moment it's needed; state whether and how long data is kept | wallet, id-verifier, healthkit | The login demo note also says nothing is stored |

## 3. Personas and journey implications

| Persona | Step | Implication | Sources |
|---|---|---|---|
| Evaluating developer: anonymous, skeptical, scanning | Landing | Value before commitment; searchable registry; "MCP" defined; no fake usage stats, stars, prices or testimonials; one call to action | design-principles, managing-accounts, inclusion, charting-data, buttons |
| Returning developer | Login (screen only) | Persistent labels; method named on the button; masked secret never prefilled; Enter submits; inline errors that say how to fix; plain note that it's a demo with no real authentication | managing-accounts, text-fields, entering-data, writing, privacy |
| Integrator wiring an MCP client | Connect account MCP | One titled dialog; scopes with purpose sentences; single Continue; determinate steps; Cancel always; status shown inline; endpoint text selectable | privacy, modality, sheets, progress-indicators, feedback, labels |
| Operator in daily use | Dashboard shell | Shell renders immediately; sidebar becomes compact navigation; empty states with actions instead of numbers; last location restored; undo for removals | loading, sidebars, tab-bars, writing, launching, undo-and-redo |
| Keyboard or screen-reader user | All steps | Full keyboard path; visible focus; labelled icons; no timed UI; no color-only status | accessibility, keyboards, focus-and-selection, icons |
| Low-vision, dark-mode or reduced-motion user | All steps | 4.5:1 contrast in both themes; follows OS theme; no thin weights; works at 200% zoom; reduced motion respected | dark-mode, typography, layout, motion |
| RTL-locale developer | All steps | Mirrored layout and back/next direction; numbers and logos not flipped | right-to-left |

## 4. Binary QA checklist (each item is PASS or FAIL)

### Landing
1. If the registry is browsable, it can be browsed and searched without logging in. In the screen-only scope, a static registry preview needs no login prompt. [managing-accounts]
2. There's exactly one prominent (accent-filled) call to action per viewport, at 1440px and at 390px. [buttons]
3. No number, metric, star count, price or testimonial appears without real backing data. [design-principles "transparent", charting-data]
4. Search sits in the header or hero, it's the only global search, and its placeholder states the scope. [searching, search-fields]
5. "MCP" is defined in plain words on first use. [inclusion]
6. The logo appears once and there's no splash screen. [branding, launching]
7. No modal or alert appears when the page loads. [alerts]

### Login (screen only)
8. Every field has a visible label that stays after typing begins. [text-fields]
9. The secret or password field is masked and never prefilled. [entering-data]
10. Email validates when focus leaves the field; submit is disabled until required fields are valid. [text-fields, entering-data]
11. Error text sits next to the field, says how to fix it, and contains no "oops", "we" or bare "Invalid". [writing]
12. The sign-in view explains why signing in is needed, in one sentence. [managing-accounts]
13. The submit button names the method (for example "Sign In with Email"). [managing-accounts]
14. A visible note says the login is a demo with no real authentication. [design-principles, privacy]
15. The form can be completed with Tab and Enter alone, in a logical order. [keyboards, text-fields]

### Connect account MCP
16. Each requested scope has a one-sentence purpose in active voice. [privacy]
17. N/A for skillar. The single-button rule covers screens shown before an OS permission alert, and the MCP registration screen is explanatory. Universal part: the screen explains what connecting does, in plain words. [privacy]
18. Conditional. If progress is shown, it's determinate ("Step N of M") with a specific description, not "Loading…". No loading simulation is required in the screen-only scope. [progress-indicators]
19. Cancel is present at every step, is never the default button, and is the only action that discards input. [alerts, sheets, popovers]
20. The dialog has a task title and never shows Cancel, Done and Back together. [modality, sheets]
21. Only one dialog is open at a time. [modality]
22. Status uses an icon plus text, not color alone. [feedback, accessibility]
23. Conditional. Any static error-state screen names a specific cause and offers a next action. No endpoint verification is implemented, so no live failure path is required. [feedback, writing]
24. Endpoint and error text can be selected. [labels]

### Dashboard shell
25. Navigation and header render before panel data, with skeletons instead of a blank area. [loading]
26. Every empty panel shows a sentence and a next-action button. [writing]
27. Navigation items aren't hidden or disabled when their section is empty. [tab-bars]
28. No chart appears without real data. [charting-data]
29. The sidebar has at most 2 levels, is visible by default, and becomes compact navigation at 390px with the same functions. [sidebars, layout]
30. The header title is not the app name and is under 15 characters. [toolbars]
31. The last panel and scroll position are restored on reload. [launching]
32. Conditional. If a destructive action is shown, it uses a specific verb button plus "Cancel", and Cancel is not the default. Skill deletion and undo aren't implemented in scope. [undo-and-redo, alerts]
33. There are no nested scroll areas in the same direction. [scroll-views]

### Global
34. Text contrast is at least 4.5:1 in light and in dark themes. [dark-mode]
35. With no saved override, the initial theme follows `prefers-color-scheme`. The existing theme override stays as a required web feature. [dark-mode, settings]
36. With `prefers-reduced-motion`, there's no slide, zoom, bounce or blur animation; fades only. [accessibility, motion]
37. Interactive targets are at least 44x44 px. [buttons]
38. Every custom control has visible hover, pressed and focus states. [buttons, focus-and-selection]
39. Focus never moves without user action. [focus-and-selection]
40. No font weight is lighter than Regular in body text. [typography]
41. The layout holds at 200% zoom without clipping or lost functions. [accessibility, layout]
42. Every icon-only button has an accessible name. [icons, accessibility]
43. No UI dismisses itself on a timer before it has been read. [accessibility]
44. Terms come from one glossary, and capitalization is consistent per element type. [writing]
45. With `dir="rtl"`, the layout mirrors, back/next flip, and logos and numbers don't. [right-to-left]
46. There's no forced onboarding tour; tips can be dismissed, are 1 to 2 sentences, and are not promotional. [onboarding, offering-help]
47. Link text is descriptive, never "Click here". [writing]

### Added from the second pass
48. Each screen has a unique document title and exactly one `<h1>`, with landmarks for header, nav and main. [voiceover]
49. Status changes are announced through a live region, and decorative images have empty alt text. [voiceover, accessibility]
50. Body text is at least 16 CSS px at 390px width, and **every interactive target is at least 44x44 CSS px at every width** (skillar design contract; the HIG's 28 pt minimum isn't used). [designing-for-games, accessibility tables, buttons; px mapping is my interpretation]
59. All text, including bold text and button labels, has at least 4.5:1 contrast. This is the skillar site contract and is stricter than the HIG table, which says (in pt) 4.5:1 up to 17 pt and 3:1 at 18 pt or for bold. Don't convert those pt values to CSS px, and don't use the 3:1 exception. For reference, WCAG 2.2 counts text as "large" only at 24 CSS px and up, or 18.66 CSS px and up when bold. Bold text at any size isn't large text under WCAG. [accessibility contrast table; https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html]
60. Primary submit buttons are never silently disabled. Either they stay enabled and explain what's missing after activation (moving focus to the field), or they're disabled with visible text that says why. [apple-pay, gestures]
61. Skeleton and placeholder content uses neutral shapes only, with no fake names, numbers or dates. [widgets, design-principles]
62. No media autoplays with sound, and any motion media has visible pause controls. [playing-video, playing-audio, accessibility]
63. Escape closes any open dialog or menu without saving, matching Cancel. [alerts, keyboards]
51. Every breakpoint keeps the same set of functions, and navigation order doesn't change between widths. [designing-for-iphone-duo, layout]
52. Unavailable controls are visibly distinct and say why they're unavailable. [gestures, feedback]
53. Every swipe or drag interaction has a button or keyboard equivalent. [gestures, drag-and-drop]
54. Any AI-related copy says plainly that AI is involved, and no generated text is presented as human-written or as a verified fact. [generative-ai]
55. No badge, unread count, star rating, gauge or chart appears without real backing data. [notifications, rating-indicators, gauges, charts]
56. Any overflow or context menu duplicates actions that are reachable elsewhere, has at most 3 groups, and lists destructive items last. [context-menus, pull-down-buttons]
57. Text placed over imagery meets 4.5:1 contrast through a scrim or backing layer. [image-views, dark-mode]
58. Any tabbed panel has at most 6 tabs with noun labels. [tab-views]

## 5. Remaining gaps and caveats
- No page is excluded by title any more; all 158 pages were read (F, F2, F3).
- Tables for the first 55 pages were re-extracted and verified (section 0). Tables made only of swatch images (system colors, Activity ring colors) carry no values, because images weren't extracted.
- Images, videos and inline cross-reference link text weren't extracted on any page.
- Mapping points to CSS px, and HIG contrast to WCAG for the web, is my interpretation.
- Checklist item 14 (the demo disclaimer) is inferred from the transparency principles. It isn't a literal HIG rule.
- `links` and `tooltips` returned 404, so coverage of those topics comes only from `offering-help` and `writing`.

## 6. Applicability limits for the screens-only skillar build (limits, not violations)
The rules above are universal. Where this report names concrete skillar behavior, it's an example of how a rule would apply, not a requirement to build that behavior. The build is screens only, so the following aren't implemented, and their absence is **not** a HIG violation:
- Loading simulation, live progress and endpoint verification. Items 18, 23 and 25 apply only to states that are actually rendered; a static skeleton or a static error screen satisfies them.
- Token paste, prefilled endpoints and real OAuth or permission scopes. P8 and item 16 only constrain copy that is actually shown.
- Registry browsing and search behavior, and skill deletion or undo. P34, P44 and items 1, 4 and 32 apply only to UI that exists.
- MCP registration is an explanatory screen, not an OS pre-permission alert. The single-Continue prescription in privacy (P7, item 17) is **not universal** and doesn't apply. The universal part is a plain purpose explanation.
- Theme override is an existing required web feature. The HIG preference for following the system appearance (dark-mode, settings) means: default to the system theme when nothing is saved. It does not mean remove the override (P22, item 35).
- The demo disclaimer (item 14) is inferred from the transparency principles, not a literal HIG rule.

## 7. Coverage receipt
| Bucket | Count | Pages |
|---|---|---|
| Read in full, first pass; tables re-extracted later | 55 | Listed in section 0 |
| Read in full, second pass (with tables) | 45 | Listed in section 0 |
| Read in full, third pass (with tables), then judged | 58 | inputs (9): action-button, apple-pencil-and-scribble, camera-control, digital-crown, eyes, game-controls, gyro-and-accelerometer, nearby-interactions, remotes; technologies (26): airplay, always-on, app-clips, apple-in-app-purchase, apple-pay, augmented-reality, carekit, carplay, game-center, healthkit, homekit, icloud, id-verifier, imessage-apps-and-stickers, live-photos, mac-catalyst, machine-learning, maps, nfc, photo-editing, researchkit, shareplay, shazamkit, siri, tap-to-pay-on-iphone, wallet; components (14): dock-menus, home-screen-quick-actions, ornaments, the-menu-bar, virtual-keyboards, activity-rings, app-shortcuts, complications, controls, live-activities, snippets, top-shelf, watch-faces, widgets; foundations (4): app-icons, sf-symbols, immersive-experiences, spatial-layout; patterns (5): live-viewing-apps, playing-audio, playing-haptics, playing-video, workouts |
| 404 | 2 | links, tooltips |
| Judged N/A after reading | 71 | 13 from the second pass (designing-for-tvos, -visionos, -watchos; lockups, panels, path-controls, token-fields, column-views, outline-views, digit-entry-views, color-wells, image-wells, status-bars) plus all 58 third-pass pages as features. 12 of the 58 still contributed universal rules (V1 to V12) |
| Not extracted on any page | n/a | images, video, inline cross-reference link text |

Total enumerated: 160 slugs (158 read in full + 2 404). Not read: none.
