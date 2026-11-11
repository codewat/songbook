import 'fake-indexeddb/auto';
import * as CFB from 'cfb';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSongFile,
  addSongsToPlaylist,
  cleanupLegacyDefaultFolders,
  createFolder,
  createPlaylist,
  DEFAULT_STAGE_PREFERENCES,
  deleteFolder,
  deleteSong,
  getActiveFolders,
  getActivePlaylists,
  getActiveSongs,
  getDb,
  getOfflineStorageStats,
  getOutboxOps,
  getPlaylistItems,
  getSongBlob,
  getStagePreferences,
  hasBuiltInCloudConfig,
  markEntitySynced,
  mergeRemoteData,
  reorderPlaylistItems,
  resetDbConnectionForTests,
  saveStagePreferences,
  updateSongMeta,
} from '../src/db/localDb';
import {
  LEGACY_DEFAULT_FOLDER_IDS,
  UNFILED_FOLDER_ID,
} from '../src/types/models';
import {
  buildSongsArchiveZip,
  buildUniqueZipPath,
  formatExportZipFileName,
} from '../src/utils/exportZip';
import {
  PPTX_MIME,
  PPT_MIME,
  base64ToBytes,
  bytesToBase64,
  detectFileType,
  matchesSongTitle,
  parseFirebaseConfigSnippet,
} from '../src/utils/format';
import { parsePresentationBlob } from '../src/utils/powerpoint';

async function clearAllStores() {
  await resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('worshipdeck-songbook-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function makePptRecord(recVer: number, recInstance: number, recType: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, (recVer & 0x0f) | ((recInstance & 0x0fff) << 4), true);
  view.setUint16(2, recType, true);
  view.setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function encodeUtf16Le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

describe('SongBook Offline Database, PowerPoint Support & Outbox Sync', () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it('starts without auto-created 1. Chords or 2. Lyrics folders and allows deleting custom folders', async () => {
    const folders = await getActiveFolders();
    expect(folders).toEqual([]);

    const custom = await createFolder('Sunday Praise');
    expect(custom.isDefault).toBe(false);
    expect(await getActiveFolders()).toHaveLength(1);

    await deleteFolder(custom.id);
    expect(await getActiveFolders()).toEqual([]);
  });

  it('migrates songs from legacy 1. Chords and 2. Lyrics folders into All Songs without data loss', async () => {
    const db = await getDb();
    const oldTime = '2026-10-01T00:00:00.000Z';

    await db.put('folders', {
      id: LEGACY_DEFAULT_FOLDER_IDS[0],
      name: '1. Chords',
      isDefault: true,
      sortOrder: 1,
      createdAt: oldTime,
      updatedAt: oldTime,
      deletedAt: null,
      syncedAt: oldTime,
    });
    await db.put('folders', {
      id: LEGACY_DEFAULT_FOLDER_IDS[1],
      name: '2. Lyrics',
      isDefault: true,
      sortOrder: 2,
      createdAt: oldTime,
      updatedAt: oldTime,
      deletedAt: null,
      syncedAt: null,
    });

    const migratedSong = await addSongFile({
      file: new File([new Uint8Array([37, 80, 68, 70])], 'Amazing_Grace.pdf', {
        type: 'application/pdf',
      }),
      folderId: LEGACY_DEFAULT_FOLDER_IDS[0],
    });

    await cleanupLegacyDefaultFolders();

    const activeFolders = await getActiveFolders();
    expect(activeFolders).toEqual([]);

    const activeSongs = await getActiveSongs();
    expect(activeSongs).toHaveLength(1);
    expect(activeSongs[0].id).toBe(migratedSong.id);
    expect(activeSongs[0].folderId).toBe(UNFILED_FOLDER_ID);

    // Synced legacy folder is soft-deleted for propagation; unsynced legacy folder is removed directly
    const syncedLegacy = await db.get('folders', LEGACY_DEFAULT_FOLDER_IDS[0]);
    expect(syncedLegacy?.deletedAt).not.toBeNull();
    expect(await db.get('folders', LEGACY_DEFAULT_FOLDER_IDS[1])).toBeUndefined();
  });

  it('stores PDF, Image, PPTX, and PPT files offline inside IndexedDB and queues outbox ops', async () => {
    const pdfFile = new File([new Uint8Array([37, 80, 68, 70, 45, 49])], 'Goodness_Of_God.pdf', {
      type: 'application/pdf',
    });
    const imgFile = new File([new Uint8Array([137, 80, 78, 71])], 'Way_Maker_Lyrics.png', {
      type: 'image/png',
    });
    const pptxFile = new File([new Uint8Array([80, 75, 3, 4, 1, 2])], 'How_Great_Is_Our_God.pptx', {
      type: '',
    });
    const pptFile = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], '10000_Reasons.ppt', {
      type: '',
    });

    expect(detectFileType(pptxFile)).toBe('pptx');
    expect(detectFileType(pptFile)).toBe('ppt');

    const chordSong = await addSongFile({
      file: pdfFile,
      folderId: UNFILED_FOLDER_ID,
      songKey: 'G',
    });
    const lyricSong = await addSongFile({
      file: imgFile,
      folderId: UNFILED_FOLDER_ID,
    });
    const pptxSong = await addSongFile({
      file: pptxFile,
      folderId: UNFILED_FOLDER_ID,
    });
    const pptSong = await addSongFile({
      file: pptFile,
      folderId: UNFILED_FOLDER_ID,
    });

    expect(chordSong.fileType).toBe('pdf');
    expect(chordSong.title).toBe('Goodness Of God');
    expect(lyricSong.fileType).toBe('image');
    expect(pptxSong.fileType).toBe('pptx');
    expect(pptxSong.mimeType).toBe(PPTX_MIME);
    expect(pptSong.fileType).toBe('ppt');
    expect(pptSong.mimeType).toBe(PPT_MIME);

    expect((await getSongBlob(pptxSong.id))?.size).toBe(6);
    expect((await getSongBlob(pptSong.id))?.size).toBe(4);

    const stats = await getOfflineStorageStats();
    expect(stats.cachedFilesCount).toBe(4);
    expect(stats.totalBytes).toBe(20);

    const outbox = await getOutboxOps();
    expect(outbox).toHaveLength(4);
    expect(outbox.every((op) => op.entity === 'song' && op.action === 'upsert')).toBe(
      true
    );
  });

  it('parses real .pptx archives offline including slide order, styling, images, and speaker notes', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/presentation.xml',
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId2"/>
          <p:sldId id="257" r:id="rId1"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>`
    );
    zip.file(
      'ppt/slides/slide1.xml',
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:cSld>
          <p:bg><p:bgPr><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></p:bgPr></p:bg>
          <p:spTree>
            <p:sp>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="1828800"/></a:xfrm></p:spPr>
              <p:txBody>
                <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="4000" b="1"><a:solidFill><a:srgbClr val="FDE68A"/></a:solidFill></a:rPr><a:t>Goodness of God</a:t></a:r></a:p>
                <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>I love You Lord</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
            <p:pic>
              <p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
            </p:pic>
          </p:spTree>
        </p:cSld>
      </p:sld>`
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
        <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
      </Relationships>`
    );
    zip.file('ppt/media/logo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
          <p:txBody><a:p><a:r><a:t>Repeat chorus 2x gently</a:t></a:r></a:p></p:txBody>
        </p:sp></p:spTree></p:cSld>
      </p:notes>`
    );
    zip.file(
      'ppt/slides/slide2.xml',
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="9144000" cy="1828800"/></a:xfrm></p:spPr>
              <p:txBody>
                <a:p><a:r><a:t>All my life You have been faithful</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`
    );

    const pptxArrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const parsed = await parsePresentationBlob(
      new Blob([pptxArrayBuffer], { type: PPTX_MIME }),
      'pptx'
    );

    expect(parsed.format).toBe('pptx');
    expect(parsed.slideWidthPx).toBe(1280);
    expect(parsed.slideHeightPx).toBe(720);
    expect(parsed.slides).toHaveLength(2);

    expect(parsed.slides[0].backgroundColor).toBe('#1e293b');
    expect(parsed.slides[0].plainTextLines).toEqual(['Goodness of God', 'I love You Lord']);
    expect(parsed.slides[0].elements.some((el) => el.kind === 'image')).toBe(true);
    expect(parsed.slides[0].notesText).toBe('Repeat chorus 2x gently');

    expect(parsed.slides[1].plainTextLines).toEqual(['All my life You have been faithful']);
  });

  it('parses legacy binary .ppt OLE2 streams offline cleanly', async () => {
    const slide1List = concatBytes([
      makePptRecord(0, 0, 0x03f3, new Uint8Array(20)), // SlidePersistAtom
      makePptRecord(0, 0, 0x0fa0, encodeUtf16Le('Holy Forever\rA thousand generations')),
      makePptRecord(0, 0, 0x03f3, new Uint8Array(20)), // SlidePersistAtom 2
      makePptRecord(0, 0, 0x0fa8, encodeAscii('Your name is the highest')),
    ]);
    const slideListWithText = makePptRecord(0x0f, 0, 0x0ff0, slide1List);
    const documentContainer = makePptRecord(0x0f, 0, 0x03e8, slideListWithText);

    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, 'PowerPoint Document', documentContainer);
    const pptBytes = CFB.write(cfb, { type: 'array' }) as Uint8Array;

    const parsed = await parsePresentationBlob(
      new Blob([pptBytes as unknown as BlobPart], { type: PPT_MIME }),
      'ppt'
    );

    expect(parsed.format).toBe('ppt');
    expect(parsed.slides).toHaveLength(2);
    expect(parsed.slides[0].plainTextLines).toEqual(['Holy Forever', 'A thousand generations']);
    expect(parsed.slides[1].plainTextLines).toEqual(['Your name is the highest']);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('deduplicates outbox updates and cancels unsynced uploads if deleted offline', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'Oceans.pdf', {
      type: 'application/pdf',
    });
    const song = await addSongFile({
      file,
      folderId: UNFILED_FOLDER_ID,
    });

    await updateSongMeta(song.id, { title: 'Oceans (Where Feet May Fail)', songKey: 'D' });
    let outbox = await getOutboxOps();
    expect(outbox).toHaveLength(1);

    await deleteSong(song.id);
    outbox = await getOutboxOps();
    expect(outbox).toHaveLength(0);
    expect(await getSongBlob(song.id)).toBeUndefined();
    expect(await getActiveSongs()).toHaveLength(0);
  });

  it('supports creating custom folders, playlists, adding songs, and reordering lineup', async () => {
    const customFolder = await createFolder('Christmas Special');
    const file1 = new File([new Uint8Array([1])], 'Song_A.pdf', {
      type: 'application/pdf',
    });
    const file2 = new File([new Uint8Array([2])], 'Song_B.pptx', {
      type: PPTX_MIME,
    });

    const songA = await addSongFile({ file: file1, folderId: customFolder.id });
    const songB = await addSongFile({
      file: file2,
      folderId: UNFILED_FOLDER_ID,
    });

    const playlist = await createPlaylist({
      name: 'Sunday Morning Service',
      eventDate: '2026-11-15',
    });
    const items = await addSongsToPlaylist(playlist.id, [songA.id, songB.id]);
    expect(items).toHaveLength(2);

    await reorderPlaylistItems(playlist.id, [items[1].id, items[0].id]);
    const reordered = await getPlaylistItems(playlist.id);
    expect(reordered[0].songId).toBe(songB.id);
    expect(reordered[1].songId).toBe(songA.id);

    const outbox = await getOutboxOps();
    const order = outbox.map((o) => o.entity);
    expect(order.indexOf('folder')).toBeLessThan(order.indexOf('song'));
    expect(order.indexOf('playlist')).toBeLessThan(order.indexOf('playlist_item'));
  });

  it('protects pending local edits during remote merge and removes blobs on remote delete', async () => {
    const file = new File([new Uint8Array([10, 20, 30])], 'Build_My_Life.pdf', {
      type: 'application/pdf',
    });
    const localSong = await addSongFile({
      file,
      folderId: UNFILED_FOLDER_ID,
      title: 'Local Edited Title',
    });

    await mergeRemoteData({
      folders: [],
      songs: [
        {
          ...localSong,
          title: 'Stale Remote Title',
          updatedAt: '2099-01-01T00:00:00.000Z',
        },
      ],
      playlists: [],
      playlistItems: [],
    });

    const songs = await getActiveSongs();
    expect(songs[0].title).toBe('Local Edited Title');

    const ops = await getOutboxOps();
    const db = await getDb();
    for (const op of ops) {
      await db.delete('outbox', op.id);
    }
    await markEntitySynced('song', localSong.id, new Date().toISOString());

    await mergeRemoteData({
      folders: [],
      songs: [
        {
          ...localSong,
          deletedAt: '2099-01-02T00:00:00.000Z',
          updatedAt: '2099-01-02T00:00:00.000Z',
        },
      ],
      playlists: [],
      playlistItems: [],
    });

    expect(await getActiveSongs()).toHaveLength(0);
    expect(await getSongBlob(localSong.id)).toBeUndefined();
    expect(await getActivePlaylists()).toHaveLength(0);
  });

  it('parses Firebase JS config snippets and round-trips binary file chunks via base64', () => {
    const snippet = `
      const firebaseConfig = {
        apiKey: "AIzaSyExampleKey123",
        authDomain: "church-songs.firebaseapp.com",
        projectId: "church-songs",
        storageBucket: "church-songs.firebasestorage.app",
        messagingSenderId: "99887766",
        appId: "1:99887766:web:abcdef123"
      };
    `;
    const parsed = parseFirebaseConfigSnippet(snippet);
    expect(parsed?.apiKey).toBe('AIzaSyExampleKey123');
    expect(parsed?.projectId).toBe('church-songs');
    expect(parsed?.appId).toBe('1:99887766:web:abcdef123');
    expect(parsed?.storageBucket).toBe('church-songs.firebasestorage.app');

    const original = new Uint8Array([0, 1, 37, 80, 68, 70, 128, 254, 255]);
    const b64 = bytesToBase64(original);
    const decoded = base64ToBytes(b64);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('persists stage display preferences and detects built-in cloud config safely', async () => {
    const initial = await getStagePreferences();
    expect(initial).toEqual(DEFAULT_STAGE_PREFERENCES);

    await saveStagePreferences({
      defaultStageInvert: true,
      defaultKeepAwake: false,
    });
    const updated = await getStagePreferences();
    expect(updated).toEqual({
      defaultStageInvert: true,
      defaultKeepAwake: false,
    });

    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    vi.stubEnv('VITE_FIREBASE_APP_ID', '1:123:web:456');
    expect(hasBuiltInCloudConfig()).toBe(true);

    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    expect(hasBuiltInCloudConfig()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('exports active songs into a folder-organized ZIP archive and deduplicates names', async () => {
    const used = new Set<string>();
    expect(buildUniqueZipPath(used, 'Chords/Team', 'Grace.pdf')).toBe('Chords_Team/Grace.pdf');
    expect(buildUniqueZipPath(used, 'Chords/Team', 'Grace.pdf')).toBe('Chords_Team/Grace (2).pdf');
    expect(formatExportZipFileName(new Date('2026-11-10T12:00:00Z'))).toMatch(
      /^songbook-songs-\d{4}-\d{2}-\d{2}\.zip$/
    );

    const worshipFolder = await createFolder('Sunday Acoustic');
    const chordFile = new File([new Uint8Array([37, 80, 68, 70])], 'Oceans.pdf', {
      type: 'application/pdf',
    });
    const duplicateNameFile = new File([new Uint8Array([1, 2, 3, 4])], 'Oceans.pdf', {
      type: 'application/pdf',
    });
    const slideFile = new File([new Uint8Array([80, 75, 3, 4])], 'Victory.pptx', {
      type: PPTX_MIME,
    });
    const missingBlobFile = new File([new Uint8Array([9, 9])], 'MissingOffline.pdf', {
      type: 'application/pdf',
    });

    const song1 = await addSongFile({ file: chordFile, folderId: worshipFolder.id });
    const song2 = await addSongFile({ file: duplicateNameFile, folderId: worshipFolder.id });
    const song3 = await addSongFile({ file: slideFile, folderId: UNFILED_FOLDER_ID });
    const missingSong = await addSongFile({ file: missingBlobFile, folderId: UNFILED_FOLDER_ID });

    // Remove one blob to verify missing offline file skipping does not fail archive generation
    const db = await getDb();
    await db.delete('blobs', missingSong.id);

    const progressUpdates: number[] = [];
    const result = await buildSongsArchiveZip({
      songs: [song1, song2, song3, missingSong],
      folders: [worshipFolder],
      resolveBlob: async (song) => (await getSongBlob(song.id))?.blob ?? null,
      onProgress: (p) => progressUpdates.push(p.processed),
    });

    expect(result.includedCount).toBe(3);
    expect(result.skippedSongs.map((s) => s.id)).toEqual([missingSong.id]);
    expect(progressUpdates.length).toBeGreaterThan(0);

    const zipBytes = new Uint8Array(await result.blob.arrayBuffer());
    const unpacked = await JSZip.loadAsync(zipBytes);
    const entryNames = Object.values(unpacked.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    expect(entryNames).toEqual([
      'All Songs/Victory.pptx',
      'Sunday Acoustic/Oceans (2).pdf',
      'Sunday Acoustic/Oceans.pdf',
    ]);
  });

  it('filters songs strictly by song title without matching key or notes', async () => {
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'Track_01.pdf', {
      type: 'application/pdf',
    });
    const song = await addSongFile({
      file,
      folderId: UNFILED_FOLDER_ID,
      title: 'Holy Forever',
      songKey: 'G',
      tempo: '72 BPM',
      notes: 'Capo 3 acoustic bridge',
    });

    expect(matchesSongTitle(song, '')).toBe(true);
    expect(matchesSongTitle(song, 'holy')).toBe(true);
    expect(matchesSongTitle(song, 'Forever')).toBe(true);
    expect(matchesSongTitle(song, 'G')).toBe(false);
    expect(matchesSongTitle(song, 'Capo')).toBe(false);
    expect(matchesSongTitle(song, 'Track_01')).toBe(false);
  });
});
