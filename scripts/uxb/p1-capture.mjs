import { writeFile } from "node:fs/promises";
/**
 * Crop composited pixels, including native rings and overflowing close controls.
 * A target taller than the viewport (a full document) is captured beyond the
 * viewport from its document box, never cropped or scaled.
 */
export async function captureP1(page, selector, path) {
  const box = await page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) throw new RangeError(`Missing capture target ${selector}`);
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const rect = node.getBoundingClientRect(), padding = 16, dpr = devicePixelRatio;
    if (rect.height + 2 * padding > innerHeight) {
      const x = Math.max(0, Math.floor(rect.left + scrollX - padding)), y = Math.max(0, Math.floor(rect.top + scrollY - padding));
      return { beyond: true, x, y, width: Math.ceil(rect.width + 2 * padding), height: Math.ceil(rect.height + 2 * padding), dpr };
    }
    const x = Math.max(0, Math.floor(rect.left - padding)), y = Math.max(0, Math.floor(rect.top - padding));
    const width = Math.min(innerWidth - x, Math.ceil(rect.right + padding) - x);
    const height = Math.min(innerHeight - y, Math.ceil(rect.bottom + padding) - y);
    if (width <= 0 || height <= 0 || rect.bottom > innerHeight + 1 || rect.top < -1)
      throw new RangeError(`Capture must fit visible viewport: ${selector}`);
    return { x: x * dpr, y: y * dpr, width: width * dpr, height: height * dpr, dpr };
  }, selector);
  const shot = box.beyond
    ? await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } })
    : await page._sendToTarget("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const crop = box.beyond ? { x: 0, y: 0, width: box.width * box.dpr, height: box.height * box.dpr } : box;
  const cropped = await page.evaluate(async ({ shot, box }) => {
    const image = new Image(); image.src = `data:image/png;base64,${shot}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = box.width; canvas.height = box.height;
    canvas.getContext("2d").drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const pixels = canvas.getContext("2d").getImageData(0, 0, box.width, box.height).data;
    let opaque = 0, varied = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 255) opaque++;
      if (pixels[index] !== pixels[0] || pixels[index + 1] !== pixels[1] || pixels[index + 2] !== pixels[2]) varied++;
    }
    return { data: canvas.toDataURL("image/png").split(",")[1], opaque, varied };
  }, { shot: shot.data, box: crop });
  const bytes = Buffer.from(cropped.data, "base64");
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || !cropped.opaque)
    throw new TypeError(`Defective PNG capture ${path}`);
  await writeFile(path, bytes);
  return { path, width: crop.width, height: crop.height, opaque: cropped.opaque, varied: cropped.varied, beyondViewport: !!box.beyond };
}
