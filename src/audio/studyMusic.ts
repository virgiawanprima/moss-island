export type StudyTrackId = 'jazz-noir' | 'wave-to-earth' | 'laufey' | 'rainy-lofi';
export const STUDY_COVERS: Record<StudyTrackId, { file: string; label: string }> = {
  'jazz-noir': { file: '/audio/piano-cover.svg', label: 'Ilustrasi piano, bukan sampul video' },
  'wave-to-earth': { file: '/audio/guitar-cover.svg', label: 'Ilustrasi gitar, bukan sampul video' },
  laufey: { file: '/audio/piano-cover.svg', label: 'Ilustrasi piano, bukan sampul video' },
  'rainy-lofi': { file: '/audio/lofi-cover.svg', label: 'Ilustrasi meja musik, bukan sampul video' },
};
export const STUDY_TRACKS = [
  { id: 'jazz-noir', title: 'Jazz Noir', artist: 'Tom’s Jazz Lounge', description: 'Jazz noir · Playlist berulang.', file: '/audio/zmeHQsFYOYg.webm', license: 'Hak cipta pemilik rekaman', source: 'https://www.youtube.com/watch?v=zmeHQsFYOYg' },
  { id: 'wave-to-earth', title: 'Wave to Earth', artist: 'B PLAYLIST', description: 'Wave to Earth · Playlist berulang.', file: '/audio/QOC5v9Yaj_k.webm', license: 'Hak cipta pemilik rekaman', source: 'https://www.youtube.com/watch?v=QOC5v9Yaj_k' },
  { id: 'laufey', title: 'Laufey', artist: 'YES24', description: 'Laufey · Playlist berulang.', file: '/audio/PggT2sFOsVg.webm', license: 'Hak cipta pemilik rekaman', source: 'https://www.youtube.com/watch?v=PggT2sFOsVg' },
  { id: 'rainy-lofi', title: 'Rainy Lo-fi', artist: 'chill chill journal', description: 'Lo-fi dengan hujan · Playlist berulang.', file: '/audio/9kzE8isXlQY.webm', license: 'Hak cipta pemilik rekaman', source: 'https://www.youtube.com/watch?v=9kzE8isXlQY' },
] as const;
