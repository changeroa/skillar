#!/usr/bin/env bun
import { postHook } from "../dist/cli/hook-post.js";

await postHook(process.argv[2] ?? "unknown");
process.exit(0);
