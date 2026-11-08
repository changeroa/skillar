# Private skill transfer

The web library stores immutable versions of `SKILL.md` and supporting files in your account. Web publication reads only files you choose, and requires the upload checkbox. CLI publication reads only the directory you explicitly select and requires a separate publication command. Activity consent and private skill permission are independent.

## Connect a private-capable device

Sign in on the web dashboard. In **Devices and consent**, select **Also allow this device to read and publish my private skills**, then connect a device and download its one-time grant file. The checkbox starts unchecked for each new device.

Use the connection command shown beside that download:

```sh
skillar sync connect --grant-file ./skillar-grant.txt --origin https://skillar.sh
```

Replace the file path with your actual download. Existing activity-only credentials do not gain private access automatically. Connecting uploads no skill files and requires no running daemon.

## Review and publish

Choose a self-contained skill directory. Its regular files are package members; unsupported paths, symlinks, archives and resource quotas are rejected. `SKILL.md` must be valid UTF-8 with `name` and `description` front matter.

```sh
skillar skills push-preview --source-dir ./my-skill --plan ./publication-plan.json
```

Preview sends only identity and metadata requests. It prints the skill ID, selected resource paths, byte counts and digests, and saves a mode-0600 plan containing the private package. Save the plan outside its source directory. It is not a publication acknowledgement.

After reviewing that selection:

```sh
skillar skills push --plan ./publication-plan.json --allow-private-upload
```

Publication rechecks the source directory and connection against the plan, then submits the reviewed package with its expected remote head. Changed source files or another connection require a fresh preview. To update an existing skill rather than create a new one, pass its printed ID as `--skill-id` to `push-preview`.

A concurrent head change returns a conflict instead of overwriting it. Offline and unverified responses are errors, not successful acknowledgements. If a network failure leaves the result uncertain, inspect the web library before preparing another publication.

Packages allow at most 128 resources, 512 KiB per resource and 2 MiB total. The encoded request is limited to 3 MiB, and the server limits `SKILL.md` to 64 KiB. No selected document or script is executed.

## Download an immutable export

Set `SKILL_ID` to the ID printed by your publication or shown in the web library:

```sh
skillar skills pull --skill-id "$SKILL_ID" --output ./private-export.json
```

The current head is resolved once and downloaded by its immutable digest. Add `--version` with a version digest to select an older version. All file hashes and manifest membership are verified before creating the export. An existing output file is not replaced.

You can instead use **Export JSON** on a version in the web library. Both exports use the same package format.

## Preview and apply local files

These commands work offline and do not acknowledge cloud delivery. Select an existing destination directory explicitly; there is no discovered default. Local apply paths must have no symlink components, including ancestors. On macOS, use `/private/tmp` rather than `/tmp` when supplying an absolute temporary path.

```sh
mkdir ./installed-skill
skillar skills preview --package ./private-export.json \
  --destination-root ./installed-skill --plan ./apply-plan.json
```

Preview creates only the plan, outside the destination. It prints each planned create or overwrite and captures current target identities and bytes. Existing target files require a new preview with `--allow-overwrite`, even when their bytes already match.

```sh
skillar skills apply --plan ./apply-plan.json
```

Apply rechecks the plan, writes a private recovery receipt before changing targets, and reports its receipt path. It never executes a document or supporting script. Recovery directories are retained under the destination.

To undo that apply, set `RECEIPT` to the exact path reported by it:

```sh
skillar skills rollback --receipt "$RECEIPT"
```

Rollback restores only files that still match the installed identity and content. User edits are conflicts and are left in place; safe files can still be recovered, and incomplete recovery returns nonzero. Local operations use optimistic filesystem checks, not a transaction against other local writers. Keep the recovery directory until you are satisfied.
