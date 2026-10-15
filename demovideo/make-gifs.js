/**
 * Turns the recorded clips (demovideo/.data/gif-clips/*.webm) into the ten pitch-deck GIFs (docs/pitch/gifs/).
 * Clips whose names start with the same "gNN" are joined, in order, into one GIF.
 *
 *   node demovideo/make-gifs.js              every GIF
 *   node demovideo/make-gifs.js 7            only gif-07
 *   GIF_WIDTH=960 GIF_FPS=10 node ...        smaller files
 *
 * Frames are taken with the ffmpeg that ships with Playwright (no system ffmpeg needed) and encoded with gifenc.
 * Only the pixels that changed since the last frame are stored; the rest is transparent, which keeps the files small.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const CLIPS = path.join(__dirname, '.data', 'gif-clips');
const OUT = path.join(__dirname, '..', 'docs', 'pitch', 'gifs');
const WIDTH = Number(process.env.GIF_WIDTH || 1280);
const FPS = Number(process.env.GIF_FPS || 12);
const SAME = 6; // a pixel within this distance on every channel counts as unchanged

function ffmpegPath() {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const dir of fs.readdirSync(root).filter(d => d.startsWith('ffmpeg-')).sort().reverse()) {
    for (const name of ['ffmpeg-mac', 'ffmpeg-linux', 'ffmpeg-win64.exe']) {
      const p = path.join(root, dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Playwright ffmpeg not found: run  npx playwright install ffmpeg');
}

function framesOf(clip, dir) {
  execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', clip, '-vf', `scale=${WIDTH}:-2`, '-r', String(FPS), path.join(dir, path.basename(clip, '.webm') + '-%05d.png')]);
}

function encode(pngFiles, target) {
  const gif = GIFEncoder();
  let shown = null; // what the viewer currently sees, after the frames so far
  const delay = Math.round(1000 / FPS);
  pngFiles.forEach((file, i) => {
    const { width, height, data } = PNG.sync.read(fs.readFileSync(file));
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.length);
    if (!shown) {
      const palette = quantize(rgba, 256);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
      shown = new Uint8Array(rgba.length);
      for (let p = 0; p < index.length; p++) { const c = palette[index[p]]; shown.set([c[0], c[1], c[2], 255], p * 4); }
      return;
    }
    // Changed pixels only; the palette is made from them, with the last entry kept for "transparent"
    const changed = [];
    for (let p = 0; p < width * height; p++) {
      const o = p * 4;
      if (Math.abs(rgba[o] - shown[o]) > SAME || Math.abs(rgba[o + 1] - shown[o + 1]) > SAME || Math.abs(rgba[o + 2] - shown[o + 2]) > SAME) changed.push(p);
    }
    const T = 255;
    const index = new Uint8Array(width * height).fill(T);
    let palette = [[0, 0, 0]];
    if (changed.length) {
      const sample = new Uint8Array(changed.length * 4);
      changed.forEach((p, k) => sample.set(rgba.subarray(p * 4, p * 4 + 4), k * 4));
      palette = quantize(sample, 255);
      const idx = applyPalette(sample, palette);
      changed.forEach((p, k) => {
        index[p] = idx[k];
        const c = palette[idx[k]];
        shown[p * 4] = c[0]; shown[p * 4 + 1] = c[1]; shown[p * 4 + 2] = c[2];
      });
    }
    while (palette.length < 256) palette.push([0, 0, 0]);
    gif.writeFrame(index, width, height, { palette, delay, transparent: true, transparentIndex: T, dispose: 1 });
    if (i % 40 === 0) process.stdout.write('.');
  });
  gif.finish();
  fs.writeFileSync(target, gif.bytes());
}

function main() {
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  fs.mkdirSync(OUT, { recursive: true });
  const clips = fs.readdirSync(CLIPS).filter(f => /\.webm$/.test(f));
  const groups = new Map();
  for (const f of clips) {
    const m = /-g(\d\d)[a-z]?-/.exec(f);
    if (!m) continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(f);
  }
  for (const [n, files] of [...groups].sort()) {
    if (only.length && !only.includes(Number(n))) continue;
    files.sort((a, b) => a.replace(/^\d+-/, '').localeCompare(b.replace(/^\d+-/, '')));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gif-${n}-`));
    try {
      for (const f of files) framesOf(path.join(CLIPS, f), tmp);
      // frames in clip order, then frame order
      const pngs = files.flatMap(f => fs.readdirSync(tmp).filter(p => p.startsWith(path.basename(f, '.webm') + '-')).sort().map(p => path.join(tmp, p)));
      const target = path.join(OUT, `gif-${n}.gif`);
      process.stdout.write(`gif-${n}: ${files.length} clip(s), ${pngs.length} frames `);
      encode(pngs, target);
      console.log(` ${(fs.statSync(target).size / 1048576).toFixed(1)} MB`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
main();
