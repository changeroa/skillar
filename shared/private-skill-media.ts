const TEXT_TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown", markdown: "text/markdown", txt: "text/plain", json: "application/json",
  yaml: "application/yaml", yml: "application/yaml", toml: "application/toml", csv: "text/csv",
  html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", ts: "text/plain",
  py: "text/x-python", sh: "application/x-sh", svg: "image/svg+xml",
};
/** Stable text types override OS guesses; unknown files stay opaque unless a valid type is supplied. */
export function privateSkillMediaType(path: string, reportedType = ""): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const known = extension === undefined ? undefined : TEXT_TYPES[extension];
  if (known !== undefined) return known;
  const reported = reportedType.split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(reported) && reported.length <= 128 ?
    reported : "application/octet-stream";
}
