import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSongFile,
  addSongsToPlaylist,
  createFolder,
  createPlaylist,
  deleteFolder,
  deleteSong,
  ensureDefaultFolders,
  getActiveFolders,
  getActivePlaylists,
  getActiveSongs,
  getDb,
  getOfflineStorageStats,
  getOutboxOps,
  getPlaylistItems,
  getSongBlob,
  markEntitySynced,
  mergeRemoteData,
  reorderPlaylistItems,
  resetDbConnectionForTests,
  updateSongMeta,
} from '../src/db/localDb';
import {
  DEFAULT_CHORDS_FOLDER_ID,
  DEFAULT_LYRICS_FOLDER_ID,
} from '../src/types/models';
import {
  base64ToBytes,
  bytesToBase64,
  parseFirebaseConfigSnippet,
} from '../src/utils/format';

async function clearAllStores() {
  await resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('worshipdeck-songbook-db');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

describe('WorshipDeck Offline Database & Outbox Sync Logic', () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it('creates default 1. Chords and 2. Lyrics folders with fixed IDs and protects them from deletion', async () => {
    await ensureDefaultFolders();
    const folders = await getActiveFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0].id).toBe(DEFAULT_CHORDS_FOLDER_ID);
    expect(folders[0].name).toBe('1. Chords');
    expect(folders[1].id).toBe(DEFAULT_LYRICS_FOLDER_ID);
    expect(folders[1].name).toBe('2. Lyrics');

    await expect(deleteFolder(DEFAULT_CHORDS_FOLDER_ID)).rejects.toThrow(
      /cannot be deleted/i
    );
  });

  it('stores PDF and Image bytes offline inside IndexedDB and queues outbox ops', async () => {
    await ensureDefaultFolders();

    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    const pdfFile = new File([pdfBytes], 'Goodness_Of_God.pdf', {
      type: 'application/pdf',
    });

    const imgBytes = new Uint8Array([137, 80, 78, 71]);
    const imgFile = new File([imgBytes], 'Way_Maker_Lyrics.png', {
      type: 'image/png',
    });

    const chordSong = await addSongFile({
      file: pdfFile,
      folderId: DEFAULT_CHORDS_FOLDER_ID,
      songKey: 'G',
    });
    const lyricSong = await addSongFile({
      file: imgFile,
      folderId: DEFAULT_LYRICS_FOLDER_ID,
    });

    expect(chordSong.fileType).toBe('pdf');
    expect(chordSong.title).toBe('Goodness Of God');
    expect(lyricSong.fileType).toBe('image');

    const chordBlob = await getSongBlob(chordSong.id);
    const lyricBlob = await getSongBlob(lyricSong.id);
    expect(chordBlob).toBeDefined();
    expect(chordBlob?.size).toBe(8);
    expect(lyricBlob?.size).toBe(4);

    const stats = await getOfflineStorageStats();
    expect(stats.cachedFilesCount).toBe(2);
    expect(stats.totalBytes).toBe(12);

    const outbox = await getOutboxOps();
    expect(outbox).toHaveLength(2);
    expect(outbox.every((op) => op.entity === 'song' && op.action === 'upsert')).toBe(
      true
    );
  });

  it('deduplicates outbox updates and cancels unsynced uploads if deleted offline', async () => {
    await ensureDefaultFolders();
    const file = new File([new Uint8Array([1, 2, 3])], 'Oceans.pdf', {
      type: 'application/pdf',
    });
    const song = await addSongFile({
      file,
      folderId: DEFAULT_CHORDS_FOLDER_ID,
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
    await ensureDefaultFolders();
    const customFolder = await createFolder('Christmas Special');
    const file1 = new File([new Uint8Array([1])], 'Song_A.pdf', {
      type: 'application/pdf',
    });
    const file2 = new File([new Uint8Array([2])], 'Song_B.png', {
      type: 'image/png',
    });

    const songA = await addSongFile({ file: file1, folderId: customFolder.id });
    const songB = await addSongFile({
      file: file2,
      folderId: DEFAULT_LYRICS_FOLDER_ID,
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
    await ensureDefaultFolders();
    const file = new File([new Uint8Array([10, 20, 30])], 'Build_My_Life.pdf', {
      type: 'application/pdf',
    });
    const localSong = await addSongFile({
      file,
      folderId: DEFAULT_CHORDS_FOLDER_ID,
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
});
