import { writeFile } from "node:fs/promises";

/** Compare actual unfocused/focused PNG pixels, including inset outlines. */
export async function paintedFocus(page, selector, output) {
  const geometry = await page.evaluate(selector => {
    const node = document.querySelector(selector);
    node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    node.blur();
    const paint = node.matches('input[type="checkbox"],input[type="radio"]') ? node.nextElementSibling :
      node.matches("select") ? node.closest(".lf-select-wrap") : node;
    const box = paint.getBoundingClientRect();
    const x = Math.max(0, Math.floor(box.left + scrollX - 8));
    const y = Math.max(0, Math.floor(box.top + scrollY - 8));
    return { left: box.left + scrollX - x, top: box.top + scrollY - y,
      width: box.width, height: box.height, dpr: devicePixelRatio,
      clip: { x, y, width: Math.ceil(box.right + scrollX + 8 - x),
        height: Math.ceil(box.bottom + scrollY + 8 - y), scale: 1 } };
  }, selector);
  const before = await page._sendToTarget("Page.captureScreenshot",
    { format: "png", clip: geometry.clip, captureBeyondViewport: true });
  await page.evaluate(selector => document.querySelector(selector).focus({ preventScroll: true }), selector);
  const after = await page._sendToTarget("Page.captureScreenshot",
    { format: "png", clip: geometry.clip, captureBeyondViewport: true });
  if (output) for (const [state, image] of [["before", before], ["focused", after]])
    await writeFile(`${output}-${state}.png`, Buffer.from(image.data, "base64"));
  return page.evaluate(async ({ before, after, geometry }) => {
    const decode = async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
    };
    const [base, focus] = await Promise.all([decode(before), decode(after)]);
    const luminance = (image, x, y) => {
      const index = (y * image.width + x) * 4;
      const rgb = [0, 1, 2].map(channel => image.pixels[index + channel] / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    const contrasting = (x, y) => {
      x = Math.floor(x * geometry.dpr); y = Math.floor(y * geometry.dpr);
      if (x < 0 || y < 0 || x >= base.width || y >= base.height) return false;
      const a = luminance(base, x, y), b = luminance(focus, x, y);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3;
    };
    const { left, top, width, height } = geometry;
    let adjacentContrastingPairs = 0;
    // Two consecutive CSS pixels must change with >=3:1 contrast. A 1px border
    // or a background-colored offset shadow cannot satisfy this indicator.
    for (const vertical of [false, true]) for (const end of [false, true]) {
      const length = vertical ? height : width;
      for (let along = 4; along < length - 4; along++) for (let depth = -6; depth < 2; depth++) {
        const point = d => vertical ?
          [left + (end ? width - 1 - d : d), top + along] :
          [left + along, top + (end ? height - 1 - d : d)];
        if (contrasting(...point(depth)) && contrasting(...point(depth + 1))) adjacentContrastingPairs++;
      }
    }
    return { adjacentContrastingPairs, minimumContrast: 3, thicknessCssPixels: 2,
      pass: adjacentContrastingPairs >= Math.max(4, Math.floor((width + height) / 10)) };
  }, { before: before.data, after: after.data, geometry });
}
