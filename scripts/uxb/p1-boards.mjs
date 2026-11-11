import { mkdir, readFile, writeFile } from "node:fs/promises";
const [out] = process.argv.slice(2);
const { loadOmowright } = await import(process.env.OMOWRIGHT_HELPER);
const { omowright } = await loadOmowright();
const browser = await omowright.connect("http://127.0.0.1:9333");
const tabs = omowright.createAgentTabs(browser);
const { page } = await tabs.create("about:blank");
const initial = JSON.parse(await readFile(`${out}/screens.json`, "utf8"));
const corrected = JSON.parse(await readFile(`${out}/document-correction/screens.json`, "utf8"));
const screens = [...initial.rows.filter(row => row.name !== "document"), ...corrected.rows];
const source = JSON.parse(await readFile(`${out}/demo-context.json`, "utf8"));
const rows = [];
await mkdir(`${out}/boards`, { recursive: true });
try {
  for (const after of screens.filter(row => row.version === "after" && row.status === "PASS")) {
    const before = screens.find(row => row.name === after.name && row.width === after.width && row.theme === after.theme && row.version === "before");
    const demoName = after.name === "home" || after.name === "account" || after.name === "connections" ? "home" : "prompt";
    const demo = source.find(row => row.name === demoName && row.width === after.width && row.theme === after.theme && row.status === "PASS");
    if (!before?.file || !demo?.file) {
      rows.push({ name: after.name, width: after.width, theme: after.theme, status: "FAIL", reason: "Missing genuine source or baseline frame" });
      continue;
    }
    const data = await Promise.all([demo.file, before.file, after.file].map(async file =>
      `data:image/png;base64,${(await readFile(file)).toString("base64")}`));
    const image = await page.evaluate(async ({ data, labels }) => {
      const images = await Promise.all(data.map(async src => { const img = new Image(); img.src = src; await img.decode(); return img; }));
      const canvas = document.createElement("canvas"), title = 32;
      canvas.width = images.reduce((sum, img) => sum + img.width, 0);
      canvas.height = Math.max(...images.map(img => img.height)) + title;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fafafa"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = "14px system-ui"; context.fillStyle = "#18181b";
      let x = 0;
      images.forEach((img, index) => { context.fillText(labels[index], x + 8, 21); context.drawImage(img, x, title); x += img.width; });
      return canvas.toDataURL("image/png").split(",")[1];
    }, { data, labels: [`REAL DEMO ${demoName}: layout context, different product/data`, "BEFORE b8b1d62", "AFTER PR-8"] });
    const file = `${out}/boards/${after.name}-${after.width}-${after.theme}-triple.png`;
    await writeFile(file, Buffer.from(image, "base64"));
    rows.push({ name: after.name, width: after.width, theme: after.theme, file, demo: demo.file, before: before.file, after: after.file,
      status: "PASS", note: "Context board, not same-data pixel parity or independent approval." });
  }
} finally {
  await writeFile(`${out}/boards.json`, JSON.stringify(rows, null, 2));
  await tabs.closeAll(); await browser.close();
}
console.log(`P1_BOARDS ${rows.filter(row => row.status === "PASS").length}/${rows.length} complete`);
process.exitCode = rows.some(row => row.status === "FAIL") ? 1 : 0;
