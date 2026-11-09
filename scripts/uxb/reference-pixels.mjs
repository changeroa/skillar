import { readFile } from "node:fs/promises";

export async function inspectReferenceImage(page, record) {
  const data = (await readFile(record.path)).toString("base64");
  const pixels = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    return { rgba: [...context.getImageData(0, 0, image.width, image.height).data],
      width: image.width, height: image.height };
  }, data);
  return inspectReferencePixels(pixels.rgba, pixels.width, pixels.height,
    { control: record.control, checked: /aria-checked="true"/.test(record.html) });
}

/** Inspect the original crop, including its context, without masks or resizing. */
export function inspectReferencePixels(rgba, width, height, { control, checked = false } = {}) {
  if (rgba.length !== width * height * 4) throw new RangeError("Invalid reference RGBA dimensions");
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = rgba.slice(i, i + 4).join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dominantPixels = Math.max(...counts.values());
  const failures = [];
  if (counts.size < 2 || dominantPixels === width * height) failures.push("blank uniform crop");
  let darkPixels = 0, lightPixels = 0;
  for (let y = 4; y < height - 4; y++) for (let x = 4; x < width - 4; x++) {
    const i = (y * width + x) * 4;
    const luminance = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    if (rgba[i + 3] > 0 && luminance < 100) darkPixels++;
    if (rgba[i + 3] > 0 && luminance > 150) lightPixels++;
  }
  if (control === "Checkbox" && checked && (!darkPixels || !lightPixels))
    failures.push("checked checkbox must show both its fill and contrasting check");
  return { width, height, uniqueColors: counts.size, dominantPixels, darkPixels, lightPixels,
    pass: failures.length === 0, failures };
}
