export function grayscaleFromRgba(rgba) {
  const gray = new Float32Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  }
  return gray;
}

export function prepareTemplate(gray, width, height) {
  let mean = 0;
  for (const value of gray) mean += value;
  mean /= gray.length || 1;
  const centered = new Float32Array(gray.length);
  let norm = 0;
  for (let i = 0; i < gray.length; i += 1) {
    centered[i] = gray[i] - mean;
    norm += centered[i] * centered[i];
  }
  return { centered, width, height, norm: Math.sqrt(norm) };
}

export function findTemplate(search, searchWidth, searchHeight, template) {
  const { centered, width, height, norm: templateNorm } = template;
  if (!templateNorm || width > searchWidth || height > searchHeight) {
    return { x: 0, y: 0, score: -1 };
  }
  let best = { x: 0, y: 0, score: -1 };
  const count = width * height;
  for (let oy = 0; oy <= searchHeight - height; oy += 1) {
    for (let ox = 0; ox <= searchWidth - width; ox += 1) {
      let mean = 0;
      for (let y = 0; y < height; y += 1) {
        const row = (oy + y) * searchWidth + ox;
        for (let x = 0; x < width; x += 1) mean += search[row + x];
      }
      mean /= count;
      let dot = 0;
      let candidateNorm = 0;
      let ti = 0;
      for (let y = 0; y < height; y += 1) {
        const row = (oy + y) * searchWidth + ox;
        for (let x = 0; x < width; x += 1, ti += 1) {
          const centeredCandidate = search[row + x] - mean;
          dot += centered[ti] * centeredCandidate;
          candidateNorm += centeredCandidate * centeredCandidate;
        }
      }
      const score = dot / (templateNorm * Math.sqrt(candidateNorm) || 1);
      if (score > best.score) best = { x: ox, y: oy, score };
    }
  }
  return best;
}
