import { z } from "zod";
import {
  privatePackLoadSchema, privatePackPhases, privatePackSearchSchema, privatePackUri,
  privatePackLoadResultSchema, privatePackSearchResultSchema,
} from "../../../shared/private-packs.ts";
import type { PrivatePackMember } from "../../../shared/private-packs.ts";
import { searchSkills } from "../../../server/src/skill-search.ts";
import { packVersionSchema, PrivatePackError } from "./private-packs-store.ts";
import type { PrivatePackStore, PackVersion } from "./private-packs-store.ts";

async function resolve(store: PrivatePackStore, version: PackVersion) {
  const definition = await store.definition(version);
  const members = await store.members(definition);
  const head = await store.head(version.name);
  if (head === null || head.tombstoned) throw new PrivatePackError("not_found", 404);
  return {
    uri: privatePackUri(version.name), digest: version.digest, definition, members,
    created_by: version.created_by, created_at: head.created_at,
    updated_by: version.created_by, updated_at: version.created_at,
    publication_status: head.digest === version.digest ? "published" : "verified_snapshot",
  };
}

export async function searchPrivatePacks(store: PrivatePackStore, input: z.infer<typeof privatePackSearchSchema>) {
  await store.live();
  const rows = await store.env.ACTIVITY.prepare(`SELECT v.* FROM private_pack_versions v
    JOIN private_pack_heads h USING(account_id,generation,name,digest)
    WHERE v.account_id=? AND v.generation=? AND h.tombstoned=0 ORDER BY v.name`)
    .bind(...store.identity()).all();
  const available = [];
  for (const version of z.array(packVersionSchema).parse(rows.results)) {
    try { available.push(await resolve(store, version)); }
    catch (error) {
      if (error instanceof PrivatePackError &&
          ["not_found", "pack_tombstoned", "member_unavailable", "member_not_pinned"].includes(error.code)) continue;
      throw error;
    }
  }
  const found = searchSkills(available.map(pack => ({
    uri: pack.uri, name: pack.definition.name, description: pack.definition.description,
    keywords: [pack.definition.display_name, pack.definition.scope, ...pack.members.map(member => member.name)],
    automatic: true, digest: pack.digest,
  })), input.query, input.mode);
  const byUri = new Map(available.map(pack => [pack.uri, pack]));
  const packs = found.slice(input.offset, input.offset + input.limit).map(match => {
    const pack = byUri.get(match.uri);
    if (pack === undefined) throw new PrivatePackError("pack_integrity");
    return { uri: pack.uri, digest: pack.digest, ...pack.definition,
      created_by: pack.created_by, created_at: pack.created_at,
      updated_by: pack.updated_by, updated_at: pack.updated_at, publication_status: pack.publication_status };
  });
  // ACCOUNTS membership and ACTIVITY metadata are separate authorities, not a distributed transaction.
  for (const pack of packs) {
    await store.version(pack.name, pack.digest);
    await store.members(pack);
  }
  await store.live();
  return privatePackSearchResultSchema.parse({
    packs, totalMatches: found.length, offset: input.offset, limit: input.limit,
    ...(input.offset + packs.length < found.length ? { nextOffset: input.offset + packs.length } : {}),
  });
}

export async function loadPrivatePacks(store: PrivatePackStore, input: z.infer<typeof privatePackLoadSchema>) {
  await store.live();
  const packs = [];
  for (const selection of input.packs) {
    packs.push(await resolve(store, await store.version(selection.uri.slice(15), selection.digest)));
  }
  const members = new Map<string, {
    uri: string; phase: PrivatePackMember["phase"]; required: boolean; invocation: string;
    digest: string; manifest_digest: string;
    requirements: Array<PrivatePackMember & { readonly pack_uri: string; readonly pack_digest: string }>;
  }>();
  for (const pack of packs) for (const member of pack.members) {
    const previous = members.get(member.skill_id);
    if (previous !== undefined &&
        (previous.phase !== member.phase || previous.manifest_digest !== member.manifest_digest)) {
      throw new PrivatePackError("member_conflict");
    }
    const record = previous ?? {
      uri: member.uri, phase: member.phase, required: false, invocation: member.invocation,
      digest: member.digest, manifest_digest: member.manifest_digest, requirements: [],
    };
    record.required ||= member.selection === "required";
    record.requirements.push({
      uri: member.uri, phase: member.phase, selection: member.selection, when: member.when,
      pack_uri: pack.uri, pack_digest: pack.digest,
    });
    members.set(member.skill_id, record);
  }
  for (const phase of ["scope", "verify"]) {
    if ([...members.values()].filter(member => member.phase === phase).length !== 1) {
      throw new PrivatePackError("composition_conflict");
    }
  }
  for (const pack of packs) {
    await store.version(pack.definition.name, pack.digest);
    await store.members(pack.definition);
  }
  await store.live();
  return privatePackLoadResultSchema.parse({
    packs: packs.map(({ members: _members, ...pack }) => pack),
    members: [...members.values()].sort((a, b) => privatePackPhases.indexOf(a.phase) - privatePackPhases.indexOf(b.phase)),
    composition: {
      declared_members: packs.reduce((sum, pack) => sum + pack.definition.members.length, 0),
      unique_members: members.size, single_scope_and_verifier: true, load_selected_bodies_only: true,
    },
    permissions: { grants_execution: false, grants_delegation: false, grants_publication: false },
    guidance: "Selection does not activate skills. Honor explicit invocation and task permissions. " +
      "Evaluate every retained condition; record selections, exclusions, actual loads, evidence and uncovered scope. " +
      "Unavailable activation is incomplete coverage; loading a pack is not a completed review.",
  });
}
