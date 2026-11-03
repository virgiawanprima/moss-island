import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STUDY_TRACKS } from '../src/audio/studyMusic';

const credits = fs.readFileSync('public/audio/CREDITS.md', 'utf8');
assert.equal(new Set(STUDY_TRACKS.map(track => track.file)).size, 4);
for (const track of STUDY_TRACKS) {
  const file = 'public' + track.file;
  assert.ok(fs.existsSync(file), `${file} belum tersedia. Audio tidak disertakan di Git; lihat README.`);
  assert.ok(fs.statSync(file).size > 1000000, `${file} kosong atau terlalu kecil untuk rekaman lokal`);
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(4);
  try { assert.equal(fs.readSync(fd, header, 0, 4, 0), 4); }
  finally { fs.closeSync(fd); }
  assert.equal(header.toString('hex'), '1a45dfa3', `${file} harus berupa container WebM asli`);
  assert.ok(credits.includes(track.source));
  assert.ok(credits.includes(track.license));
  console.log(`LULUS: ${track.title} tersedia, header WebM dan kredit valid`);
}
