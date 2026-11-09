import { readFile, writeFile } from "node:fs/promises";

export function comparePixels(reference, actual, threshold = 0) {
  if (reference.length !== actual.length || reference.length % 4)
    throw new RangeError("RGBA buffers must have the same pixel dimensions");
  const diff = new Uint8ClampedArray(actual.length);
  let diffPixels = 0, rawDiffPixels = 0, maxChannelDelta = 0;
  for (let i = 0; i < actual.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(reference[i + channel] - actual[i + channel])));
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    const changed = reference[i + 3] !== actual[i + 3] ||
      [0, 1, 2].some(channel => Math.abs(reference[i + channel] - actual[i + channel]) > threshold);
    if (delta) rawDiffPixels++;
    if (changed) diffPixels++;
    diff.set(delta ? [255, 0, 96, 255] : [actual[i], actual[i + 1], actual[i + 2], 48], i);
  }
  const totalPixels = actual.length / 4;
  return { diff, diffPixels, rawDiffPixels, maxChannelDelta, totalPixels,
    diffRatio: totalPixels ? diffPixels / totalPixels : 0 };
}

/** Compares original pixels without scaling. Mismatched dimensions never pass. */
export async function diffImages(page, paths) {
  const sources = await Promise.all([paths.reference, paths.actual].map(async path => {
    const bytes = await readFile(path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new TypeError(`Capture is not a PNG: ${path}`);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }));
  const images = await page.evaluate(async sources => {
    const loaded = await Promise.all(sources.map(src => new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(Error("PNG decode timed out")), 5000);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => { clearTimeout(timer); reject(Error("Invalid PNG capture")); };
      image.src = src;
    })));
    const [left, right] = loaded;
    const width = Math.max(left.width, right.width), height = Math.max(left.height, right.height);
    const pixels = loaded.map(image => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return [...context.getImageData(0, 0, width, height).data];
    });
    const side = document.createElement("canvas");
    side.width = left.width + right.width; side.height = height;
    side.getContext("2d").drawImage(left, 0, 0);
    side.getContext("2d").drawImage(right, left.width, 0);
    return { width, height, reference: { width: left.width, height: left.height },
      actual: { width: right.width, height: right.height }, pixels, side: side.toDataURL("image/png") };
  }, sources);
  const comparison = comparePixels(images.pixels[0], images.pixels[1], paths.channelTolerance ?? 0);
  const encoded = await page.evaluate(({ width, height, pixels }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas.toDataURL("image/png");
  }, { width: images.width, height: images.height, pixels: [...comparison.diff] });
  await writeFile(paths.sideBySide, Buffer.from(images.side.split(",")[1], "base64"));
  await writeFile(paths.diff, Buffer.from(encoded.split(",")[1], "base64"));
  const { diff, ...counts } = comparison;
  return { ...counts, reference: images.reference, actual: images.actual,
    dimensionsMatch: images.reference.width === images.actual.width && images.reference.height === images.actual.height,
    similarityScore: 100 * (1 - counts.diffRatio), channelTolerance: paths.channelTolerance ?? 0, alphaCompared: true };
}
