import { Word, UserStats, LLMConfig, TTSConfig, ApiRequestLog } from "../types";
import { deduplicateDeletedWords } from "../utils/cloudSyncMerge";
import { sanitizeLlmConfig } from "../utils/llmHelpers";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

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
  settings: "settings",
  deletedWords: "deleted_words",
  apiLogs: "api_logs"
} as const;

type StoreName = keyof typeof STORES;

const ALL_STORES: StoreName[] = ["words", "stats", "settings", "deletedWords", "apiLogs"];

/** Keys of records kept inside the shared `settings` store. */
const KEYS = {
  stats: "user_stats",
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
  settings: "key",
  deletedWords: "id",
  apiLogs: "id"
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
/* LLM & TTS Config (Stored in localStorage)                                 */
/* -------------------------------------------------------------------------- */

const LOCAL_CONFIG_KEYS = {
  llmConfig: "vocab_learner_llm_config",
  ttsConfig: "vocab_learner_tts_config"
} as const;

export function getLLMConfigFromLocalStorage(defaultConfig: LLMConfig): LLMConfig {
  try {
    const raw = lsGet(LOCAL_CONFIG_KEYS.llmConfig);
    if (raw) {
      const parsed = parseJSON<LLMConfig>(raw, "llm config");
      if (parsed) {
        return sanitizeLlmConfig(parsed);
      }
    }
  } catch (err) {
    console.error("Error loading LLM config from localStorage:", err);
  }
  return sanitizeLlmConfig(defaultConfig);
}

export function saveLLMConfigToLocalStorage(config: LLMConfig): void {
  try {
    const sanitized = sanitizeLlmConfig(config);
    lsSet(LOCAL_CONFIG_KEYS.llmConfig, JSON.stringify(sanitized));
  } catch (err) {
    console.error("Error saving LLM config to localStorage:", err);
  }
}

export function getTTSConfigFromLocalStorage(defaultConfig: TTSConfig): TTSConfig {
  try {
    const raw = lsGet(LOCAL_CONFIG_KEYS.ttsConfig);
    if (raw) {
      const parsed = parseJSON<Partial<TTSConfig>>(raw, "tts config");
      if (parsed) return { ...defaultConfig, ...parsed };
    }
  } catch (err) {
    console.error("Error loading TTS config from localStorage:", err);
  }
  return defaultConfig;
}

export function saveTTSConfigToLocalStorage(config: TTSConfig): void {
  try {
    lsSet(LOCAL_CONFIG_KEYS.ttsConfig, JSON.stringify(config));
  } catch (err) {
    console.error("Error saving TTS config to localStorage:", err);
  }
}

export async function getLLMConfigFromDB(defaultConfig: LLMConfig): Promise<LLMConfig> {
  return getLLMConfigFromLocalStorage(defaultConfig);
}

export async function saveLLMConfigToDB(config: LLMConfig): Promise<void> {
  saveLLMConfigToLocalStorage(config);
}

export async function getTTSConfigFromDB(defaultConfig: TTSConfig): Promise<TTSConfig> {
  return getTTSConfigFromLocalStorage(defaultConfig);
}

export async function saveTTSConfigToDB(config: TTSConfig): Promise<void> {
  saveTTSConfigToLocalStorage(config);
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
    settings: StoredSetting[];
    deletedWords?: DeletedWordRecord[];
    config?: never;
  };
}

// Export the full database as a JSON object (one snapshot-consistent transaction)
export async function exportIndexedDBDatabase(): Promise<IndexedDBExportData> {
  const [words, stats, settings, deletedWords] = await withStores(ALL_STORES, "readonly", (tx) =>
    Promise.all([
      readAll<Word>(tx, "words"),
      readAll<StoredRecord<UserStats>>(tx, "stats"),
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

  const stores = { words, stats: cleanedStats, settings, deletedWords };

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

  // Preserve existing local settings if the imported payload has empty/missing keys
  try {
    const existingSettings = await withStores(["settings"], "readonly", (tx) => readAll<StoredSetting>(tx, "settings"));

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

/* -------------------------------------------------------------------------- */
/* API Request & Response Logs (Dynamic limit: max(100, 15 * totalModels))     */
/* -------------------------------------------------------------------------- */

function getMaxApiLogsLimit(): number {
  const totalModelsCount = PROVIDER_OPTIONS.reduce((acc, provider) => {
    if (provider.id === "auto") return acc;
    return acc + (provider.models ? provider.models.length : 0);
  }, 0);
  return Math.max(100, totalModelsCount * 15);
}

export async function saveApiRequestLogToDB(log: ApiRequestLog): Promise<void> {
  try {
    const maxLogs = getMaxApiLogsLimit();
    await withStores(["apiLogs"], "readwrite", async (tx) => {
      const store = tx.objectStore(STORES.apiLogs);
      store.put(log);

      // Read all records to trim to max logs limit
      const allLogsReq = store.getAll();
      allLogsReq.onsuccess = () => {
        const allLogs = (allLogsReq.result ?? []) as ApiRequestLog[];
        if (allLogs.length > maxLogs) {
          // Sort oldest first and delete overflow entries
          allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          const toDelete = allLogs.slice(0, allLogs.length - maxLogs);
          for (const item of toDelete) {
            if (item.id) store.delete(item.id);
          }
        }
      };
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vocab-api-logs-updated"));
    }
  } catch (err) {
    console.warn("Notice: could not save API request log to IndexedDB:", err);
  }
}

export async function getApiRequestLogsFromDB(limit?: number): Promise<ApiRequestLog[]> {
  try {
    const maxLimit = typeof limit === "number" ? limit : getMaxApiLogsLimit();
    const logs = await withStores(["apiLogs"], "readonly", (tx) => readAll<ApiRequestLog>(tx, "apiLogs"));
    // Sort newest first
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return logs.slice(0, maxLimit);
  } catch (err) {
    console.warn("Notice: could not load API request logs from IndexedDB:", err);
    return [];
  }
}

export async function clearApiRequestLogsFromDB(): Promise<void> {
  try {
    await withStores(["apiLogs"], "readwrite", (tx) => {
      tx.objectStore(STORES.apiLogs).clear();
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vocab-api-logs-updated"));
    }
  } catch (err) {
    console.warn("Notice: could not clear API request logs in IndexedDB:", err);
  }
}


