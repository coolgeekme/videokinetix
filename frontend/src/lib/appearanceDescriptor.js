export function createSpatialColorHistogram(rgba, width, height) {
  const binsPerRegion = 64; // 4 x 4 x 4 RGB bins
  const histogram = new Float32Array(binsPerRegion * 2); // upper/lower body
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    const regionOffset = y < height / 2 ? 0 : binsPerRegion;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      if (rgba[pixel + 3] < 128) continue;
      const r = Math.min(3, rgba[pixel] >> 6);
      const g = Math.min(3, rgba[pixel + 1] >> 6);
      const b = Math.min(3, rgba[pixel + 2] >> 6);
      histogram[regionOffset + r * 16 + g * 4 + b] += 1;
      samples += 1;
    }
  }
  if (!samples) return null;
  let norm = 0;
  for (const value of histogram) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(histogram, (value) => value / norm);
}

export function createRegionalColorHistogram(regions) {
  const binsPerRegion = 64;
  const histogram = new Float32Array(binsPerRegion * regions.length);
  let populatedRegions = 0;
  regions.forEach((region, regionIndex) => {
    const offset = regionIndex * binsPerRegion;
    let regionSamples = 0;
    for (let i = 0; i + 3 < region.length; i += 4) {
      if (region[i + 3] < 128) continue;
      const r = Math.min(3, region[i] >> 6);
      const g = Math.min(3, region[i + 1] >> 6);
      const b = Math.min(3, region[i + 2] >> 6);
      histogram[offset + r * 16 + g * 4 + b] += 1;
      regionSamples += 1;
    }
    if (!regionSamples) return;
    let regionNorm = 0;
    for (let i = 0; i < binsPerRegion; i += 1) {
      regionNorm += histogram[offset + i] * histogram[offset + i];
    }
    regionNorm = Math.sqrt(regionNorm) || 1;
    for (let i = 0; i < binsPerRegion; i += 1) {
      histogram[offset + i] /= regionNorm;
    }
    populatedRegions += 1;
  });
  if (!populatedRegions) return null;
  const norm = Math.sqrt(populatedRegions);
  return Float32Array.from(histogram, (value) => value / norm);
}

export function appearanceSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

export function bestAppearanceSimilarity(gallery, candidate) {
  if (!candidate || !gallery?.length) return 0;
  let best = 0;
  for (const descriptor of gallery) {
    best = Math.max(best, appearanceSimilarity(descriptor, candidate));
  }
  return best;
}

export function blendAppearance(previous, current, alpha = 0.08) {
  if (!previous) return current;
  if (!current || previous.length !== current.length) return previous;
  const blended = new Float32Array(previous.length);
  let norm = 0;
  for (let i = 0; i < previous.length; i += 1) {
    blended[i] = previous[i] * (1 - alpha) + current[i] * alpha;
    norm += blended[i] * blended[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < blended.length; i += 1) blended[i] /= norm;
  return blended;
}
