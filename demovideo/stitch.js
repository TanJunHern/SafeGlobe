/**
 * Joins the numbered clips into one .webm, without re-encoding and without installing anything.
 *
 * All clips are VP9 at the same size and frame rate, so their frames can simply follow one another: each clip's
 * clusters are copied into one file with their timestamps moved along. The ffmpeg that ships with Playwright then
 * copies the result once more, which adds the seek index and the total duration.
 *
 *   node demovideo/stitch.js                          the cut that follows the script in DEMO_GUIDE.md
 *   node demovideo/stitch.js all                      every clip
 *   node demovideo/stitch.js 01 02 04 name=my-cut     chosen clips, in that order
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLIPS = path.join(__dirname, 'clips');
const ID = { EBML: 0x1A45DFA3, SEGMENT: 0x18538067, INFO: 0x1549A966, TRACKS: 0x1654AE6B, CLUSTER: 0x1F43B675, TIMECODE: 0xE7, TIMECODE_SCALE: 0x2AD7B1, SIMPLE_BLOCK: 0xA3, BLOCK_GROUP: 0xA0, BLOCK: 0xA1 };
const FRAME_MS = 40; // 25 frames a second
// The seven scenes of the script, in order (see demovideo/README.md for what each clip shows)
const SCRIPT_CUT = ['01', '02', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '18', '19', '21'];

// --- reading EBML (the container format of WebM) ---
function readId(buf, pos) {
  const first = buf[pos];
  const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : 4;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}
function readSize(buf, pos) {
  const first = buf[pos];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  let value = first & (0xFF >> len);
  let unknown = value === (0xFF >> len);
  for (let i = 1; i < len; i++) { value = value * 256 + buf[pos + i]; if (buf[pos + i] !== 0xFF) unknown = false; }
  return { size: unknown ? -1 : value, len };
}
/** The elements directly inside [start, end): { id, start (of the element), dataStart, dataEnd } */
function children(buf, start, end) {
  const out = [];
  let pos = start;
  while (pos < end) {
    const id = readId(buf, pos);
    const size = readSize(buf, pos + id.len);
    const dataStart = pos + id.len + size.len;
    const dataEnd = size.size < 0 ? end : dataStart + size.size;
    out.push({ id: id.id, start: pos, dataStart, dataEnd });
    pos = dataEnd;
  }
  return out;
}
const uint = (buf, a, b) => { let v = 0; for (let i = a; i < b; i++) v = v * 256 + buf[i]; return v; };

// --- writing EBML ---
function idBytes(id) { const b = []; let v = id; while (v > 0) { b.unshift(v & 0xFF); v = Math.floor(v / 256); } return Buffer.from(b); }
function sizeBytes(size) { // always 8 bytes: simple, and large enough for any cluster
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  let v = size;
  for (let i = 7; i >= 1; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
  return b;
}
function uintBytes(value) { const b = []; let v = value; do { b.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return Buffer.from(b); }
const element = (id, data) => Buffer.concat([idBytes(id), sizeBytes(data.length), data]);

/** One clip: its track description, and its clusters with the time of each (in milliseconds). */
function readClip(file) {
  const buf = fs.readFileSync(file);
  const top = children(buf, 0, buf.length);
  const segment = top.find(e => e.id === ID.SEGMENT);
  if (!segment) throw new Error(`${path.basename(file)} is not a WebM file`);
  const parts = children(buf, segment.dataStart, segment.dataEnd);
  const info = parts.find(e => e.id === ID.INFO);
  const scaleEl = info && children(buf, info.dataStart, info.dataEnd).find(e => e.id === ID.TIMECODE_SCALE);
  const scale = scaleEl ? uint(buf, scaleEl.dataStart, scaleEl.dataEnd) : 1000000;
  if (scale !== 1000000) throw new Error(`${path.basename(file)} does not use millisecond timestamps`);
  const tracks = parts.find(e => e.id === ID.TRACKS);
  const clusters = [];
  let end = 0;
  for (const c of parts.filter(e => e.id === ID.CLUSTER)) {
    const inside = children(buf, c.dataStart, c.dataEnd);
    const tc = inside.find(e => e.id === ID.TIMECODE);
    const time = uint(buf, tc.dataStart, tc.dataEnd);
    const rest = inside.filter(e => e.id !== ID.TIMECODE).map(e => buf.subarray(e.start, e.dataEnd));
    // Each block carries its own time, relative to its cluster: the last one tells how long the clip is
    for (const e of inside) {
      const blocks = e.id === ID.SIMPLE_BLOCK ? [e] : e.id === ID.BLOCK_GROUP ? children(buf, e.dataStart, e.dataEnd).filter(x => x.id === ID.BLOCK) : [];
      for (const b of blocks) { const track = readSize(buf, b.dataStart); end = Math.max(end, time + buf.readInt16BE(b.dataStart + track.len) + FRAME_MS); }
    }
    clusters.push({ time, rest });
  }
  return { header: buf.subarray(top[0].start, top[0].dataEnd), tracks: buf.subarray(tracks.start, tracks.dataEnd), clusters, ms: end };
}

function stitch(files, target) {
  const clips = files.map(readClip);
  const info = element(ID.INFO, Buffer.concat([element(ID.TIMECODE_SCALE, uintBytes(1000000)), element(0x4D80, Buffer.from('DueDilly stitch')), element(0x5741, Buffer.from('DueDilly stitch'))]));
  const out = [clips[0].header, idBytes(ID.SEGMENT), Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), info, clips[0].tracks];
  let offset = 0;
  for (const clip of clips) {
    for (const c of clip.clusters) out.push(element(ID.CLUSTER, Buffer.concat([element(ID.TIMECODE, uintBytes(offset + c.time)), ...c.rest])));
    offset += clip.ms;
  }
  const joined = path.join(os.tmpdir(), `duedilly-joined-${process.pid}.webm`);
  fs.writeFileSync(joined, Buffer.concat(out));
  // A plain copy through ffmpeg adds the seek index and the duration. Nothing is re-encoded.
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dir = fs.existsSync(cache) ? fs.readdirSync(cache).find(d => d.startsWith('ffmpeg-')) : null;
  const ffmpeg = dir ? path.join(cache, dir, 'ffmpeg-mac') : null;
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', joined, '-c', 'copy', target]);
    fs.unlinkSync(joined);
  } else {
    fs.renameSync(joined, target); // plays, but without a seek index
  }
  return { seconds: Math.round(offset / 100) / 10, clips: clips.length, mb: Math.round(fs.statSync(target).size / 1024 / 1024 * 10) / 10 };
}

function main() {
  const args = process.argv.slice(2);
  const name = (args.find(a => a.startsWith('name=')) || '').split('=')[1];
  const picks = args.filter(a => !a.startsWith('name='));
  const all = fs.readdirSync(CLIPS).filter(f => /^\d\d-.*\.webm$/.test(f)).sort();
  const wanted = picks[0] === 'all' ? all.map(f => f.slice(0, 2)) : picks.length ? picks : SCRIPT_CUT;
  const files = wanted.map(n => { const f = all.find(x => x.startsWith(n + '-')); if (!f) throw new Error(`No clip numbered ${n}`); return path.join(CLIPS, f); });
  const target = path.join(__dirname, `${name || (picks[0] === 'all' ? 'duedilly-demo-all-clips' : picks.length ? 'duedilly-demo-custom' : 'duedilly-demo-script')}.webm`);
  const out = stitch(files, target);
  console.log(`${path.basename(target)}: ${out.clips} clips, ${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')}, ${out.mb} MB`);
  for (const f of files) console.log('  ' + path.basename(f));
}

if (require.main === module) main();
module.exports = { stitch, readClip, SCRIPT_CUT };
