import { Word, UserStats, LLMConfig, TTSConfig } from "../types";
import { deduplicateDeletedWords } from "../utils/cloudSyncMerge";
import { sanitizeLlmConfig } from "../utils/llmHelpers";

const DB_NAME = "VocabLearnerDB";

/**
 * Recorded in backup files for provenance. The live connection does NOT open at
 * this version: `connect()` attaches to whatever version exists and bumps it
 * only when a store is missing, so older databases get repaired in place.
 */
const DB_SCHEMA_VERSION = 1;

const STORES = {
  words: "words",
  stats: "stats",
  config: "config",
  settings: "settings",
  deletedWords: "deleted_words"
} as const;

type StoreName = keyof typeof STORES;

const ALL_STORES: StoreName[] = ["words", "stats", "config", "settings", "deletedWords"];

/** Keys of records kept inside the shared `config` / `settings` stores. */
const KEYS = {
  stats: "user_stats",
  llmConfig: "llm_config",
  ttsConfig: "tts_config",
  initialized: "db_initialized"
} as const;

const LEGACY_KEYS = {
  initialized: "vocab_learner_db_initialized",
  decks: "vocab_learner_decks",
  decksBackup: "vocab_learner_decks_backup",
  stats: "vocab_learner_stats",
  llmConfig: "vocab_learner_llm_config",
  ttsConfig: "vocab_learner_tts_config"
} as const;

/* -------------------------------------------------------------------------- */
/* localStorage (never throws: private mode / quota / disabled storage)        */
/* -------------------------------------------------------------------------- */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseJSON<T>(raw: string | null, label: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Failed parsing legacy ${label} from localStorage:`, err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                 */
/* -------------------------------------------------------------------------- */

/** Key path used by each store. */
const STORE_KEY_PATHS: Record<StoreName, string> = {
  words: "id",
  stats: "id",
  config: "id",
  settings: "key",
  deletedWords: "id"
};

function createMissingStores(db: IDBDatabase): void {
  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(STORES[name])) {
      db.createObjectStore(STORES[name], { keyPath: STORE_KEY_PATHS[name] });
    }
  }
}

function findMissingStores(db: IDBDatabase): StoreName[] {
  return ALL_STORES.filter((name) => !db.objectStoreNames.contains(STORES[name]));
}

/**
 * Opens the database. Omit `version` to attach to whatever version exists
 * (and create it at v1 if it does not exist yet).
 */
function requestOpen(version?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade is blocked by another open tab. Close other tabs and reload."));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Connects and guarantees the schema is complete.
 *
 * A database created by an older build can sit at version 1 with only some of
 * the stores. Opening at a fixed DB_VERSION would never fire `onupgradeneeded`
 * for it, so every `objectStore()` call on a missing store throws NotFoundError.
 * Instead we attach to the current version, and if anything is missing we
 * re-open one version higher to create it.
 */
async function connect(): Promise<IDBDatabase> {
  let db = await requestOpen();

  if (findMissingStores(db).length > 0) {
    const nextVersion = db.version + 1;
    db.close();
    db = await requestOpen(nextVersion);

    const stillMissing = findMissingStores(db);
    if (stillMissing.length > 0) {
      db.close();
      throw new Error(`IndexedDB schema upgrade failed; missing stores: ${stillMissing.join(", ")}`);
    }
  }

  // Release the connection so another tab can upgrade instead of blocking it.
  db.onversionchange = () => {
    db.close();
    dbPromise = null;
  };
  db.onclose = () => {
    dbPromise = null;
  };

  return db;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = connect().catch((err) => {
    console.error("IndexedDB open failed:", err);
    dbPromise = null; // allow a later retry
    throw err;
  });

  return dbPromise;
}

/* -------------------------------------------------------------------------- */
/* Transaction primitives & Notifications                                     */
/* -------------------------------------------------------------------------- */

function notifyLocalDBUpdated(): void {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vocab-db-updated"));
    }
  } catch {
    /* ignore */
  }
}

/** Resolves when the whole transaction commits, so writes are durable. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Runs `work` inside a single transaction over `stores` and waits for the commit.
 * One transaction per logical operation keeps the number of round trips minimal.
 */
async function withStores<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => T | Promise<T>
): Promise<T> {
  const db = await openDB();
  // `openDB` guarantees every store exists, so no filtering is needed here.
  // Filtering would silently drop a store from the tx while the callback still
  // asks for it by name, turning a schema problem into a NotFoundError.
  const names = stores.map((name) => STORES[name]);

  const tx = db.transaction(names.length === 1 ? names[0] : names, mode);
  const done = txDone(tx);
  // Keep `done` handled even if `work` throws, so it never becomes an unhandled rejection.
  done.catch(() => undefined);

  const result = await work(tx);
  await done;
  return result;
}

function readAll<T>(tx: IDBTransaction, store: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(STORES[store]).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

function readOne<T>(tx: IDBTransaction, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(STORES[store]).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Queues clear + puts without awaiting each request; IndexedDB preserves order. */
function replaceAll(tx: IDBTransaction, store: StoreName, items: readonly unknown[]): void {
  const objectStore = tx.objectStore(STORES[store]);
  objectStore.clear();
  for (let i = 0; i < items.length; i++) objectStore.put(items[i]);
}

/** Reads a single-record store entry of the shape `{ id, data }`. */
async function readRecordData<T>(store: StoreName, key: string): Promise<T | null> {
  const record = await withStores([store], "readonly", (tx) => readOne<{ data?: T }>(tx, store, key));
  return record?.data ?? null;
}

/** Writes a single-record store entry of the shape `{ id, data, updatedAt }`. */
function writeRecordData(store: StoreName, key: string, data: unknown): Promise<void> {
  return withStores([store], "readwrite", (tx) => {
    tx.objectStore(STORES[store]).put({ id: key, data, updatedAt: new Date().toISOString() });
  });
}

/** Marks the DB as initialized in both IndexedDB and localStorage. */
async function markInitialized(): Promise<void> {
  await saveSettingToDB(KEYS.initialized, "true");
  lsSet(LEGACY_KEYS.initialized, "true");
}

/* -------------------------------------------------------------------------- */
/* Words                                                                      */
/* -------------------------------------------------------------------------- */

/** Extracts words out of the legacy `{ words: Word[] }[]` deck structure. */
function migrateLegacyDecks(): Word[] | null {
  const decks = parseJSON<{ words?: Word[] }[]>(lsGet(LEGACY_KEYS.decks), "decks");
  if (!Array.isArray(decks) || decks.length === 0) return null;
  const words = decks.flatMap((deck) => deck.words ?? []);
  return words.length > 0 ? words : null;
}

/**
 * Loads all words, falling back to a legacy localStorage migration or an empty
 * array on a fresh install. An initialized-but-empty DB stays empty.
 */
export async function getAllWordsFromDB(): Promise<Word[]> {
  let initialized = lsGet(LEGACY_KEYS.initialized) === "true";

  try {
    // Words + the initialized flag live in different stores: read both in one transaction.
    // Requests are queued together (not awaited one by one) so the tx cannot auto-commit early.
    const [words, flag] = await withStores(["words", "settings"], "readonly", (tx) =>
      Promise.all([readAll<Word>(tx, "words"), readOne<{ value?: string }>(tx, "settings", KEYS.initialized)])
    );

    initialized = initialized || flag?.value === "true";

    if (words.length > 0) {
      if (!initialized) await markInitialized();
      return words;
    }

    // Previously initialized or fresh install: start empty.
    if (!initialized) await markInitialized();

    const migrated = migrateLegacyDecks() ?? [];
    if (migrated.length > 0) {
      await saveAllWordsToDB(migrated);
    }
    return migrated;
  } catch (err) {
    // Reads failed entirely (storage blocked, corrupt DB, upgrade blocked by
    // another tab). Serve something usable rather than failing, but make
    // the cause visible instead of looking like a fresh install.
    console.error("Could not read words from IndexedDB; serving in-memory fallback:", err);
    return [];
  }
}

export interface DeletedWordRecord {
  id: string;
  word: string;
  deletedAt: string;
}

export async function getDeletedWordsFromDB(): Promise<DeletedWordRecord[]> {
  try {
    const records = await withStores(["deletedWords"], "readonly", (tx) =>
      readAll<DeletedWordRecord>(tx, "deletedWords")
    );
    if (records.length > 0) {
      return deduplicateDeletedWords(records);
    }

    // Fallback/Migration: Check if legacy settings store has deleted_words
    const legacyRaw = await getSettingFromDB("deleted_words");
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const deduplicated = deduplicateDeletedWords(parsed);
          await saveDeletedWordsToDB(deduplicated);
          // Clean up legacy setting record
          await withStores(["settings"], "readwrite", (tx) => {
            tx.objectStore(STORES.settings).delete("deleted_words");
          }).catch(() => {});
          return deduplicated;
        }
      } catch (err) {
        console.error("Error parsing legacy deleted_words setting:", err);
      }
    }
    return [];
  } catch (err) {
    console.error("Error reading deleted words from IndexedDB:", err);
    return [];
  }
}

export async function saveDeletedWordsToDB(records: DeletedWordRecord[]): Promise<void> {
  try {
    const deduplicated = deduplicateDeletedWords(records);
    await withStores(["deletedWords"], "readwrite", (tx) => {
      replaceAll(tx, "deletedWords", deduplicated);
    });
  } catch (err) {
    console.error("Error saving deleted words tombstone:", err);
  }
}

export async function recordDeletedWordsInDB(items: { id: string; word?: string }[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const existing = await getDeletedWordsFromDB();
    const now = new Date().toISOString();
    const newRecords: DeletedWordRecord[] = items
      .filter((item) => item && (item.id || item.word))
      .map((item) => ({
        id: item.id || (item.word ? item.word.trim().toLowerCase() : ""),
        word: item.word || "",
        deletedAt: now
      }));

    await saveDeletedWordsToDB([...existing, ...newRecords]);
  } catch (err) {
    console.error("Error recording deleted words:", err);
  }
}

// Replace the whole word collection in a single transaction
export async function saveAllWordsToDB(words: Word[]): Promise<void> {
  try {
    // Check if any existing words were removed to record tombstones
    const existingWords = await withStores(["words"], "readonly", (tx) => readAll<Word>(tx, "words")).catch(() => []);
    if (existingWords.length > 0) {
      const newWordIds = new Set(words.map(w => w.id));
      const removedWords = existingWords.filter(w => w && w.id && !newWordIds.has(w.id));
      if (removedWords.length > 0) {
        await recordDeletedWordsInDB(removedWords.map(w => ({ id: w.id, word: w.word })));
      }
    }

    await withStores(["words"], "readwrite", (tx) => replaceAll(tx, "words", words));
    await markInitialized();
    notifyLocalDBUpdated();
  } catch (err) {
    console.error("Error saving words to IndexedDB:", err);
  }
}

// Save or update a single word
export async function saveWordToDB(word: Word): Promise<void> {
  try {
    await withStores(["words"], "readwrite", (tx) => {
      tx.objectStore(STORES.words).put(word);
    });
    notifyLocalDBUpdated();
  } catch (err) {
    console.error("Error saving word to IndexedDB:", err);
  }
}

// Save or update several words in one transaction
export async function saveWordsToDB(words: readonly Word[]): Promise<void> {
  if (words.length === 0) return;
  try {
    await withStores(["words"], "readwrite", (tx) => {
      const store = tx.objectStore(STORES.words);
      for (let i = 0; i < words.length; i++) store.put(words[i]);
    });
    notifyLocalDBUpdated();
  } catch (err) {
    console.error("Error saving words to IndexedDB:", err);
  }
}

// Remove a single word from IndexedDB
export async function deleteWordFromDB(wordId: string, wordText?: string): Promise<void> {
  try {
    await withStores(["words"], "readwrite", (tx) => {
      tx.objectStore(STORES.words).delete(wordId);
    });
    await recordDeletedWordsInDB([{ id: wordId, word: wordText || "" }]);
    notifyLocalDBUpdated();
  } catch (err) {
    console.error("Error deleting word from IndexedDB:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

// Load stats, migrating from localStorage the first time
export async function getStatsFromDB(defaultStats: UserStats): Promise<UserStats> {
  try {
    const stored = await readRecordData<UserStats>("stats", KEYS.stats);
    if (stored) {
      const { totalWordsMastered, totalWordsStudied, ...cleanStored } = stored as any;
      return {
        ...defaultStats,
        ...cleanStored,
        streak: {
          count: stored.streak?.count ?? 0,
          lastActiveDate: stored.streak?.lastActiveDate ?? "",
          history: Array.isArray(stored.streak?.history) ? stored.streak.history : []
        }
      };
    }

    const legacy = parseJSON<UserStats>(lsGet(LEGACY_KEYS.stats), "stats");
    const rawStats = legacy ?? defaultStats;
    const { totalWordsMastered, totalWordsStudied, ...cleanRaw } = rawStats as any;
    const stats: UserStats = {
      ...defaultStats,
      ...cleanRaw,
      streak: {
        count: rawStats.streak?.count ?? 0,
        lastActiveDate: rawStats.streak?.lastActiveDate ?? "",
        history: Array.isArray(rawStats.streak?.history) ? rawStats.streak.history : []
      }
    };
    await saveStatsToDB(stats);
    return stats;
  } catch (err) {
    console.error("IndexedDB error reading stats:", err);
    return defaultStats;
  }
}

export async function saveStatsToDB(stats: UserStats): Promise<void> {
  try {
    const { totalWordsMastered, totalWordsStudied, ...cleanStats } = stats as any;
    await writeRecordData("stats", KEYS.stats, cleanStats);
    notifyLocalDBUpdated();
  } catch (err) {
    console.error("Error saving stats to IndexedDB:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* LLM config                                                                 */
/* -------------------------------------------------------------------------- */

export async function getLLMConfigFromDB(defaultConfig: LLMConfig): Promise<LLMConfig> {
  try {
    const stored = await readRecordData<LLMConfig>("config", KEYS.llmConfig);
    if (stored) {
      const sanitized = sanitizeLlmConfig(stored);
      if (JSON.stringify(sanitized) !== JSON.stringify(stored)) {
        await saveLLMConfigToDB(sanitized);
      }
      return sanitized;
    }

    const legacy = parseJSON<LLMConfig>(lsGet(LEGACY_KEYS.llmConfig), "llm config");
    if (legacy) {
      const sanitized = sanitizeLlmConfig(legacy);
      await saveLLMConfigToDB(sanitized);
      return sanitized;
    }
    return sanitizeLlmConfig(defaultConfig);
  } catch (err) {
    console.error("Error loading LLM config from IndexedDB:", err);
    return sanitizeLlmConfig(defaultConfig);
  }
}

export async function saveLLMConfigToDB(config: LLMConfig): Promise<void> {
  try {
    await writeRecordData("config", KEYS.llmConfig, config);
  } catch (err) {
    console.error("Error saving LLM config to IndexedDB:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* TTS config                                                                 */
/* -------------------------------------------------------------------------- */

export async function getTTSConfigFromDB(defaultConfig: TTSConfig): Promise<TTSConfig> {
  try {
    const stored = await readRecordData<Partial<TTSConfig>>("config", KEYS.ttsConfig);
    if (stored) return { ...defaultConfig, ...stored };

    const legacy = parseJSON<Partial<TTSConfig>>(lsGet(LEGACY_KEYS.ttsConfig), "tts config");
    if (legacy) {
      const merged = { ...defaultConfig, ...legacy };
      await saveTTSConfigToDB(merged);
      return merged;
    }
    return defaultConfig;
  } catch (err) {
    console.error("Error loading TTS config from IndexedDB:", err);
    return defaultConfig;
  }
}

export async function saveTTSConfigToDB(config: TTSConfig): Promise<void> {
  try {
    await writeRecordData("config", KEYS.ttsConfig, config);
    lsSet(LEGACY_KEYS.ttsConfig, JSON.stringify(config));
  } catch (err) {
    console.error("Error saving TTS config to IndexedDB:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* Generic settings                                                           */
/* -------------------------------------------------------------------------- */

export async function getSettingFromDB(key: string): Promise<string | null> {
  try {
    const record = await withStores(["settings"], "readonly", (tx) =>
      readOne<{ value?: string }>(tx, "settings", key)
    );
    if (record?.value !== undefined) return record.value;

    const legacy = lsGet(key);
    if (legacy !== null) {
      // Backfill without blocking the caller.
      void saveSettingToDB(key, legacy);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveSettingToDB(key: string, value: string): Promise<void> {
  try {
    await withStores(["settings"], "readwrite", (tx) => {
      tx.objectStore(STORES.settings).put({ key, value, updatedAt: new Date().toISOString() });
    });
  } catch (err) {
    console.error("Error saving setting to IndexedDB:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* Backup / restore / reset                                                   */
/* -------------------------------------------------------------------------- */

/** Envelope used by the `stats` and `config` stores. */
export interface StoredRecord<T> {
  id: string;
  data: T;
  updatedAt?: string;
}

/** Envelope used by the `settings` store. */
export interface StoredSetting {
  key: string;
  value: string;
  updatedAt?: string;
}

export interface IndexedDBExportData {
  version: number;
  dbName: string;
  exportedAt: string;
  stores: {
    words: Word[];
    stats: StoredRecord<UserStats>[];
    config: StoredRecord<LLMConfig | TTSConfig>[];
    settings: StoredSetting[];
    deletedWords?: DeletedWordRecord[];
  };
}

// Export the full database as a JSON object (one snapshot-consistent transaction)
export async function exportIndexedDBDatabase(): Promise<IndexedDBExportData> {
  const [words, stats, config, settings, deletedWords] = await withStores(ALL_STORES, "readonly", (tx) =>
    Promise.all([
      readAll<Word>(tx, "words"),
      readAll<StoredRecord<UserStats>>(tx, "stats"),
      readAll<StoredRecord<LLMConfig | TTSConfig>>(tx, "config"),
      readAll<StoredSetting>(tx, "settings"),
      readAll<DeletedWordRecord>(tx, "deletedWords")
    ])
  );

  const cleanedStats = stats.map(rec => {
    if (rec && rec.data) {
      const { totalWordsMastered, totalWordsStudied, ...restData } = rec.data as any;
      return { ...rec, data: restData };
    }
    return rec;
  });

  const stores = { words, stats: cleanedStats, config, settings, deletedWords };

  return {
    version: DB_SCHEMA_VERSION,
    dbName: DB_NAME,
    exportedAt: new Date().toISOString(),
    stores
  };
}

export interface ImportResult {
  success: boolean;
  message: string;
  recordCounts: Record<StoreName, number>;
}

/**
 * Restores the database from a backup object. All stores are rewritten inside a
 * single transaction, so a failure mid-way rolls everything back.
 */
export async function importIndexedDBDatabase(data: unknown): Promise<ImportResult> {
  const stores = (data as { stores?: Partial<Record<StoreName, unknown[]>> } | null)?.stores;
  if (!stores || typeof stores !== "object") {
    throw new Error("Invalid backup file. Missing 'stores' object.");
  }
  if (!Array.isArray(stores.words)) {
    throw new Error("Invalid backup file: 'words' array is required.");
  }

  // Legacy backup compatibility: if stores.deletedWords is missing but stores.settings has deleted_words key, migrate it
  if (!Array.isArray(stores.deletedWords) && Array.isArray(stores.settings)) {
    const deletedWordsSetting = stores.settings.find((s: any) => s && s.key === "deleted_words") as { key?: string; value?: string } | undefined;
    if (deletedWordsSetting && typeof deletedWordsSetting.value === "string") {
      try {
        const parsed = JSON.parse(deletedWordsSetting.value);
        if (Array.isArray(parsed)) {
          stores.deletedWords = parsed;
        }
      } catch {
        // ignore
      }
    }
    // Filter out legacy deleted_words setting key
    stores.settings = stores.settings.filter((s: any) => !s || s.key !== "deleted_words");
  }

  if (Array.isArray(stores.deletedWords)) {
    stores.deletedWords = deduplicateDeletedWords(stores.deletedWords as DeletedWordRecord[]);
  }

  if (Array.isArray(stores.stats)) {
    stores.stats = stores.stats.map((rec: any) => {
      if (rec && rec.data) {
        const { totalWordsMastered, totalWordsStudied, ...restData } = rec.data;
        return { ...rec, data: restData };
      }
      return rec;
    });
  }

  // Preserve existing local API keys and settings if the imported payload has empty/missing keys
  try {
    const existingConfig = await withStores(["config"], "readonly", (tx) => readAll<StoredRecord<any>>(tx, "config"));
    const existingSettings = await withStores(["settings"], "readonly", (tx) => readAll<StoredSetting>(tx, "settings"));

    if (Array.isArray(stores.config)) {
      stores.config = stores.config.map((incomingRec: any) => {
        if (!incomingRec || !incomingRec.id) return incomingRec;
        const localMatch = existingConfig.find((c) => c.id === incomingRec.id);
        if (!localMatch || !localMatch.data) return incomingRec;

        const updatedData = { ...incomingRec.data };

        // Restore local top-level apiKey if incoming is empty
        if (!updatedData.apiKey && localMatch.data.apiKey) {
          updatedData.apiKey = localMatch.data.apiKey;
        }

        // Restore local savedProviders apiKeys
        if (localMatch.data.savedProviders && updatedData.savedProviders) {
          const mergedProviders = { ...updatedData.savedProviders };
          for (const [pKey, localP] of Object.entries(localMatch.data.savedProviders as Record<string, any>)) {
            if (localP && localP.apiKey) {
              mergedProviders[pKey] = {
                ...(mergedProviders[pKey] || {}),
                apiKey: localP.apiKey
              };
            }
          }
          updatedData.savedProviders = mergedProviders;
        }

        return { ...incomingRec, data: updatedData };
      });
    }

    if (Array.isArray(stores.settings)) {
      const incomingKeys = new Set(stores.settings.map((s: any) => s?.key));
      for (const localSetting of existingSettings) {
        if (localSetting && localSetting.key) {
          const lowerKey = localSetting.key.toLowerCase();
          if (
            (lowerKey.includes("token") || lowerKey.includes("key") || lowerKey.includes("secret")) &&
            !incomingKeys.has(localSetting.key)
          ) {
            stores.settings.push(localSetting);
          }
        }
      }
    }
  } catch (err) {
    console.warn("Notice: could not preserve existing local API keys during import", err);
  }

  const payload = ALL_STORES.map((name) => ({
    name,
    items: Array.isArray(stores[name]) ? (stores[name] as unknown[]) : null
  }));

  await withStores(ALL_STORES, "readwrite", (tx) => {
    for (const { name, items } of payload) {
      if (items) replaceAll(tx, name, items);
    }
  });

  const recordCounts = payload.reduce((acc, { name, items }) => {
    acc[name] = items?.length ?? 0;
    return acc;
  }, {} as Record<StoreName, number>);

  return { success: true, message: "Database restored successfully!", recordCounts };
}

/** Clears the given stores in one transaction and re-flags the DB as initialized. */
async function clearStores(stores: StoreName[]): Promise<void> {
  await withStores(stores, "readwrite", (tx) => {
    for (const name of stores) tx.objectStore(STORES[name]).clear();
  });

  await markInitialized();
  lsRemove(LEGACY_KEYS.decks);
  lsRemove(LEGACY_KEYS.decksBackup);
}

// Wipe every store (words, stats, config, settings, deletedWords) and clear all browser local storage
export async function resetIndexedDBDatabase(): Promise<void> {
  await clearStores(ALL_STORES);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.error("Error clearing local storage during reset:", e);
  }
  await markInitialized();
}

// Wipe words, stats, and deletedWords tombstones, keeping config and settings intact
export function clearAllWordsAndStatsFromDB(): Promise<void> {
  return clearStores(["words", "stats", "deletedWords"]);
}

