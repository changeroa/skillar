# Local private skill packages

```
skillar skills preview --package export.json --destination-root /absolute/root --plan plan.json [--allow-overwrite]
skillar skills apply --plan plan.json
skillar skills rollback --receipt /absolute/root/.skillar-private-<uuid>/receipt.json
```

The explicitly selected destination is trusted local configuration, must already
exist, and has no discovered default. Use a path with no symlink components,
including its ancestors (on macOS use `/private/tmp`, not `/tmp`). Documents are
data, never evaluated or executed. These commands do not call a daemon, upload
anything, acknowledge a remote command, or promise cloud delivery.

## Validation and preview

`package.ts` is the shared-contract facade. The shared verifier checks canonical
manifest membership, hashes, resource and aggregate quotas, binary base64, and
archive rejection. Export version and package digests must agree. Plans and
receipts reverify that package before trusting any serialized paths. Every target
and ancestor path is rederived from the explicit root and verified manifest;
serialized lists must match exactly. Local plans/receipts are authorization
artifacts, not signatures: someone able to rewrite them and the trusted root
selection can authorize a different operation within that root.

Preview only creates the requested plan outside the destination, exclusively,
at mode 0600. It never creates directories or changes target files. Existing
targets require `--allow-overwrite`, even if their bytes already match. The plan
captures ancestor device/inode/birth identities and target identity, digest,
size, mode, mtime and ctime. Packages match the local collector's 512 files and
16 MiB total, including SKILL.md; a single file can use the entire byte budget.
Existing target backups have the same 16 MiB/file and 16 MiB/total limits.
Exports, plans and receipts are bounded at 24, 25 and 50 MiB, respectively;
directory guards remain limited to 1024 and source capture to 4096 entries.

## Actual concurrency guarantee

This is optimistic conflict detection, **not** a linearizable transaction
against arbitrary noncooperating local writers. There are no dependencies,
native helpers, locks claiming to exclude other processes, or dirfd APIs.

At preflight and operation checkpoints, static symlinks, nonregular files,
changed ancestor identities and changed target snapshots are refused. Reads use
bounded file descriptors with no-follow and before/after checks. Immediately
before each mutation the relevant guards are repeated; all installed files are
checked again before successful apply is reported.

Apply creates a mode-0700 recovery directory under the destination and stages
mode-0600 files there. Before changing any target file it writes and fsyncs an
immutable mode-0600 `receipt.json`, containing verified package data, original
byte copies and the staged identities. Existing target names are moved into
retained `displaced-N` files, checked again, then installed using `link`, which
atomically refuses an occupied destination name. No replacement rename installs
new bytes. Hard-link support on the same filesystem is required; unsupported
filesystems or mount crossings fail rather than fall back to unsafe copying.
Newly created resource directories and recovery artifacts are intentionally
retained, including on preparation failure. A failure before receipt creation
has not mutated target file bytes.

On an apply failure after receipt creation, the receipt path and every automatic
rollback outcome are returned, with a nonzero CLI exit even if rollback finishes.
The receipt is a write-ahead recovery journal, not proof of a successful apply.
Explicit rollback validates its location, membership and backup hashes. It
mutates only targets still carrying the staged identity, mtime, mode and written digest,
and rechecks after staging the restoration. Changed replacements, changed bytes,
symlinks and deleted overwrite targets are conflicts, not silently overwritten.
Restoration first retains the current file, verifies it, then links the original
byte copy into the vacant name. Conflicts do not stop recovery of other safe
files. Final observed target states are checked again before reporting rollback
success. Repeat rollback is allowed; already restored original bytes need no write.
Only live automatic rollback can restore an absent target known to have just
been displaced but not installed. After a crash, such an absence is ambiguous:
explicit rollback reports a conflict and leaves the original bytes for manual
recovery rather than undoing a possible user deletion.

Node's portable path-based APIs cannot eliminate the interval between a check
and rename/link, pin ancestor directories through those operations, prevent
edits through an already open descriptor/hard link, or stop changes immediately
after a final check. A hostile local writer can still redirect an operation via
an ancestor race. Retained displaced files and inline backup bytes improve
recoverability but are not a proof of confinement under such attacks. Other
writers can also edit/delete recovery artifacts; no protection from the same
user or crash/power-loss durability of directory entries is claimed. Avoid
concurrent writers and retain the recovery directory until satisfied.

## Packaging

The `"skills/package"` facade in `local/build-cloud.mjs` bundles the shared
runtime imports into `local/dist/skills/package.js`, retaining the declared
external `zod` dependency. Standalone package tests exercise the CLI without
a repository sibling `shared/dist` directory.

Explicit publication and download commands are documented in
[`../../docs/private-skills.md`](../../docs/private-skills.md).
