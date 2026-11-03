# Production verification

PR: https://github.com/changeroa/skillar/pull/61
Merged: 2026-11-03T05:14:55Z
Merge SHA: 69c580ad81d038f6eac77f32cb95dbcf864e2e73
Reviewed feature SHA: 08cdd1bc14458d37b4147408209021f231089a46

The exact merge commit was checked out in a detached release worktree. Its tree
diff against the reviewed feature commit was empty. The implementation and
locked review worktrees were removed after merge.

Built shared first, then the site. From site/, deployed with:

```sh
npx wrangler pages deploy dist --project-name skillar-site --branch main --commit-hash 69c580ad81d038f6eac77f32cb95dbcf864e2e73
```

The command completed with exit 0 and uploaded Pages Functions along with
the static site. Deployment metadata read back:

- ID: 00000000-0000-0000-0000-000000000015
- Environment: Production
- Branch: main
- Source: 69c580a
- Deployment: https://historical-5.example.test
- Canonical: https://skillar.sh/

Canonical HTTP checks after deployment:

| URL | HTTP | Content |
| --- | --- | --- |
| https://skillar.sh/ | 200 | Prompt illustration present; workshop img absent |
| https://skillar.sh/login/ | 200 | Account page title and content present |

Live Chrome captures, personally opened and visually inspected:

- live-1440-light.png
- live-1440-dark.png
- live-390-light.png
- live-390-dark.png

390 uses CDP mobile device metrics and touch, not a desktop window resize.
All four have zero page overflow and zero overflowing illustration children.
Terminal, complete file, MCP arrow, agent label and caption are all visible.
Resource lists contain no workshop image or new hero image request.

The required render milestone and post-deploy milestone were delivered to
lead pane wZ:p1 using a Bun.spawn argv array, not shell interpolation.
No Slack posts, issue comments or PR comments were sent.
