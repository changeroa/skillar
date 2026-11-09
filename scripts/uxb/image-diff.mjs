import { readFile, writeFile } from "node:fs/promises";

/** Crop integer device pixels from the composited viewport, never re-rasterize a CSS clip. */
export async function captureCrop(page, selector) {
  const bounds = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    const before = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    if (!["static", "relative"].includes(computed.position))
      throw new RangeError(`Snapshot alignment requires flow positioning: ${selector}`);
    const originalPosition = element.style.position;
    const originalTop = element.style.top, originalLeft = element.style.left;
    const dpr = devicePixelRatio, padding = 4;
    const shiftX = Math.round(before.left * dpr) / dpr - before.left;
    const shiftY = Math.round(before.top * dpr) / dpr - before.top;
    // Layout offsets avoid interpolating a fractionally translated raster layer.
    element.style.position = "relative";
    element.style.left = `${(parseFloat(computed.left) || 0) + shiftX}px`;
    element.style.top = `${(parseFloat(computed.top) || 0) + shiftY}px`;
    const rect = element.getBoundingClientRect();
    if (rect.top < padding || rect.bottom + padding > innerHeight)
      throw new RangeError(`Specimen must fit the viewport: ${selector}`);
    const x = Math.max(0, Math.floor((rect.left - padding) * dpr));
    const y = Math.max(0, Math.floor((rect.top - padding) * dpr));
    return { x, y, width: Math.min(Math.ceil((rect.right + padding) * dpr), innerWidth * dpr) - x,
      height: Math.ceil((rect.bottom + padding) * dpr) - y, dpr,
      cssX: rect.x, cssY: rect.y, scrollY, shiftX, shiftY, originalPosition, originalTop, originalLeft };
  }, selector);
  try {
  // The first frame applies the layout offset; the second observes its paint.
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const frame = await page._sendToTarget("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: false, fromSurface: true,
  });
  const data = await page.evaluate(({ frame, bounds }) => new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(Error("Viewport decode timed out")), 5000);
    image.onerror = () => { clearTimeout(timer); reject(Error("Invalid viewport PNG")); };
    image.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      canvas.width = bounds.width; canvas.height = bounds.height;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, -bounds.x, -bounds.y);
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    };
    image.src = `data:image/png;base64,${frame}`;
  }), { frame: frame.data, bounds });
  return { data, bounds };
  } finally {
    await page.evaluate(({ selector, bounds }) => {
      const style = document.querySelector(selector).style;
      style.position = bounds.originalPosition; style.top = bounds.originalTop; style.left = bounds.originalLeft;
    }, { selector, bounds });
  }
}

export function comparePixels(reference, actual, threshold = 0, corners = null) {
  if (reference.length !== actual.length || reference.length % 4)
    throw new RangeError("RGBA buffers must have the same pixel dimensions");
  const diff = new Uint8ClampedArray(actual.length);
  let diffPixels = 0, rawDiffPixels = 0, maxChannelDelta = 0, acceptedCornerPixels = 0;
  const maxPerChannelDelta = [0, 0, 0, 0];
  for (let i = 0; i < actual.length; i += 4) {
    const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(reference[i + channel] - actual[i + channel])));
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    for (let c = 0; c < 4; c++)
      maxPerChannelDelta[c] = Math.max(maxPerChannelDelta[c], Math.abs(reference[i + c] - actual[i + c]));
    const x = corners ? i / 4 % corners.width : 0, y = corners ? Math.floor(i / 4 / corners.width) : 0;
    const inCorner = corners && corners.radius > 0 &&
      ((x >= corners.inset - 1 && x < corners.inset + corners.radius) ||
       (x >= corners.width - corners.inset - corners.radius && x <= corners.width - corners.inset)) &&
      ((y >= corners.inset - 1 && y < corners.inset + corners.radius) ||
       (y >= corners.height - corners.inset - corners.radius && y <= corners.height - corners.inset));
    const alphaChanged = reference[i + 3] !== actual[i + 3];
    const acceptedCorner = inCorner && !alphaChanged && delta > threshold && delta <= corners.tolerance;
    const changed = alphaChanged || (!acceptedCorner &&
      [0, 1, 2].some(channel => Math.abs(reference[i + channel] - actual[i + channel]) > threshold));
    if (acceptedCorner) acceptedCornerPixels++;
    if (delta) rawDiffPixels++;
    if (changed) diffPixels++;
    diff.set(delta ? [255, 0, 96, 255] : [actual[i], actual[i + 1], actual[i + 2], 48], i);
  }
  const totalPixels = actual.length / 4;
  return { diff, diffPixels, rawDiffPixels, maxChannelDelta, maxPerChannelDelta, acceptedCornerPixels,
    cornerPolicy: corners, totalPixels,
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
  const comparison = comparePixels(images.pixels[0], images.pixels[1], paths.channelTolerance ?? 0,
    paths.cornerTolerance ? { width: images.width, height: images.height, inset: paths.cornerInset,
      radius: paths.cornerRadius, tolerance: paths.cornerTolerance } : null);
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
