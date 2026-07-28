import { Word, UserStats, LLMConfig, TTSConfig } from "../types";
import { DEFAULT_WORDS } from "../defaultWords";

const DB_NAME = "VocabLearnerDB";
const DB_VERSION = 1;

interface DBStores {
  words: "words";
  stats: "stats";
  config: "config";
  settings: "settings";
}

const STORES: DBStores = {
  words: "words",
  stats: "stats",
  config: "config",
  settings: "settings"
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.words)) {
        db.createObjectStore(STORES.words, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.stats)) {
        db.createObjectStore(STORES.stats, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.config)) {
        db.createObjectStore(STORES.config, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error("IndexedDB open failed:", request.error);
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// Generic transaction helper
async function performTx<T>(
  storeName: keyof DBStores,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES[storeName], mode);
    const store = tx.objectStore(STORES[storeName]);

    let req: IDBRequest<T> | undefined;
    try {
      const result = callback(store);
      if (result) req = result;
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => {
      if (req) {
        resolve(req.result);
      } else {
        resolve(undefined as unknown as T);
      }
    };

    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

// Load all words from IndexedDB (with fallback/migration from localStorage or DEFAULT_WORDS)
export async function getAllWordsFromDB(): Promise<Word[]> {
  try {
    const isInitialized = (await getSettingFromDB("db_initialized")) === "true" || localStorage.getItem("vocab_learner_db_initialized") === "true";

    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.words, "readonly");
      const store = tx.objectStore(STORES.words);
      const req = store.getAll();

      req.onsuccess = async () => {
        const result = req.result as Word[];
        if (result && result.length > 0) {
          if (!isInitialized) {
            await saveSettingToDB("db_initialized", "true");
            localStorage.setItem("vocab_learner_db_initialized", "true");
          }
          resolve(result);
        } else if (isInitialized) {
          // User initialized DB previously and explicitly cleared all words
          resolve([]);
        } else {
          // Check localStorage for migration (legacy deck-based data)
          const legacyDecks = localStorage.getItem("vocab_learner_decks");
          if (legacyDecks) {
            try {
              const parsed = JSON.parse(legacyDecks);
              if (Array.isArray(parsed) && parsed.length > 0) {
                // Extract words from legacy deck structure
                const allWords: Word[] = parsed.flatMap((d: any) => d.words || []);
                await saveAllWordsToDB(allWords);
                await saveSettingToDB("db_initialized", "true");
                localStorage.setItem("vocab_learner_db_initialized", "true");
                resolve(allWords);
                return;
              }
            } catch (e) {
              console.error("Failed parsing legacy decks from localStorage:", e);
            }
          }
          // Default fallback on fresh install
          await saveAllWordsToDB(DEFAULT_WORDS);
          await saveSettingToDB("db_initialized", "true");
          localStorage.setItem("vocab_learner_db_initialized", "true");
          resolve(DEFAULT_WORDS);
        }
      };

      req.onerror = () => {
        console.error("Failed reading words from IndexedDB:", req.error);
        resolve(isInitialized ? [] : DEFAULT_WORDS);
      };
    });
  } catch (err) {
    console.error("IndexedDB unavailable, falling back:", err);
    const isInitialized = localStorage.getItem("vocab_learner_db_initialized") === "true";
    return isInitialized ? [] : DEFAULT_WORDS;
  }
}

// Save all words into IndexedDB
export async function saveAllWordsToDB(words: Word[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.words, "readwrite");
      const store = tx.objectStore(STORES.words);

      // Clear existing & rewrite
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const word of words) {
          store.put(word);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await saveSettingToDB("db_initialized", "true");
    try {
      localStorage.setItem("vocab_learner_db_initialized", "true");
    } catch (e) {}
  } catch (err) {
    console.error("Error saving words to IndexedDB:", err);
  }
}

// Save or update a single word efficiently
export async function saveWordToDB(word: Word): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.words, "readwrite");
      const store = tx.objectStore(STORES.words);
      store.put(word);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Error saving word to IndexedDB:", err);
  }
}

// Remove a single word from IndexedDB
export async function deleteWordFromDB(wordId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.words, "readwrite");
      const store = tx.objectStore(STORES.words);
      store.delete(wordId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Error deleting word from IndexedDB:", err);
  }
}

// Load stats from IndexedDB
export async function getStatsFromDB(defaultStats: UserStats): Promise<UserStats> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.stats, "readonly");
      const store = tx.objectStore(STORES.stats);
      const req = store.get("user_stats");

      req.onsuccess = async () => {
        if (req.result && req.result.data) {
          resolve(req.result.data as UserStats);
        } else {
          // Check localStorage migration
          const legacyStats = localStorage.getItem("vocab_learner_stats");
          if (legacyStats) {
            try {
              const parsed = JSON.parse(legacyStats);
              await saveStatsToDB(parsed);
              resolve(parsed);
              return;
            } catch (e) {
              console.error("Error parsing legacy stats:", e);
            }
          }
          await saveStatsToDB(defaultStats);
          resolve(defaultStats);
        }
      };

      req.onerror = () => resolve(defaultStats);
    });
  } catch (err) {
    console.error("IndexedDB error reading stats:", err);
    return defaultStats;
  }
}

// Save stats to IndexedDB
export async function saveStatsToDB(stats: UserStats): Promise<void> {
  try {
    await performTx("stats", "readwrite", (store) => {
      store.put({ id: "user_stats", data: stats, updatedAt: new Date().toISOString() });
    });
  } catch (err) {
    console.error("Error saving stats to IndexedDB:", err);
  }
}

// Load LLM Config from IndexedDB
export async function getLLMConfigFromDB(defaultConfig: LLMConfig): Promise<LLMConfig> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.config, "readonly");
      const store = tx.objectStore(STORES.config);
      const req = store.get("llm_config");

      req.onsuccess = async () => {
        if (req.result && req.result.data) {
          resolve(req.result.data as LLMConfig);
        } else {
          // Check legacy localStorage migration
          const legacyConfig = localStorage.getItem("vocab_learner_llm_config");
          if (legacyConfig) {
            try {
              const parsed = JSON.parse(legacyConfig);
              await saveLLMConfigToDB(parsed);
              resolve(parsed);
              return;
            } catch (e) {
              console.error("Error parsing legacy config:", e);
            }
          }
          resolve(defaultConfig);
        }
      };

      req.onerror = () => resolve(defaultConfig);
    });
  } catch (err) {
    console.error("Error loading LLM config from IndexedDB:", err);
    return defaultConfig;
  }
}

// Save LLM Config to IndexedDB
export async function saveLLMConfigToDB(config: LLMConfig): Promise<void> {
  try {
    await performTx("config", "readwrite", (store) => {
      store.put({ id: "llm_config", data: config, updatedAt: new Date().toISOString() });
    });
  } catch (err) {
    console.error("Error saving LLM config to IndexedDB:", err);
  }
}

// Load TTS Config from IndexedDB
export async function getTTSConfigFromDB(defaultConfig: TTSConfig): Promise<TTSConfig> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.config, "readonly");
      const store = tx.objectStore(STORES.config);
      const req = store.get("tts_config");

      req.onsuccess = async () => {
        if (req.result && req.result.data) {
          resolve({ ...defaultConfig, ...req.result.data });
        } else {
          const legacy = localStorage.getItem("vocab_learner_tts_config");
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy);
              const merged = { ...defaultConfig, ...parsed };
              await saveTTSConfigToDB(merged);
              resolve(merged);
              return;
            } catch (e) {
              console.error("Error parsing legacy tts config:", e);
            }
          }
          resolve(defaultConfig);
        }
      };

      req.onerror = () => resolve(defaultConfig);
    });
  } catch (err) {
    console.error("Error loading TTS config from IndexedDB:", err);
    return defaultConfig;
  }
}

// Save TTS Config to IndexedDB
export async function saveTTSConfigToDB(config: TTSConfig): Promise<void> {
  try {
    await performTx("config", "readwrite", (store) => {
      store.put({ id: "tts_config", data: config, updatedAt: new Date().toISOString() });
    });
    localStorage.setItem("vocab_learner_tts_config", JSON.stringify(config));
  } catch (err) {
    console.error("Error saving TTS config to IndexedDB:", err);
  }
}

// Generic settings get/set for IndexedDB
export async function getSettingFromDB(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.settings, "readonly");
      const store = tx.objectStore(STORES.settings);
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result && req.result.value !== undefined) {
          resolve(req.result.value);
        } else {
          // Check localStorage
          const legacyVal = localStorage.getItem(key);
          if (legacyVal) {
            saveSettingToDB(key, legacyVal);
            resolve(legacyVal);
          } else {
            resolve(null);
          }
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

export async function saveSettingToDB(key: string, value: string): Promise<void> {
  try {
    await performTx("settings", "readwrite", (store) => {
      store.put({ key, value, updatedAt: new Date().toISOString() });
    });
  } catch (err) {
    console.error("Error saving setting to IndexedDB:", err);
  }
}

// Full Database Export Data Interface
export interface IndexedDBExportData {
  version: number;
  dbName: string;
  exportedAt: string;
  stores: {
    words: Word[];
    stats: any[];
    config: any[];
    settings: any[];
  };
}

// Export full IndexedDB database as a JSON object
export async function exportIndexedDBDatabase(): Promise<IndexedDBExportData> {
  const db = await openDB();

  const getStoreData = <T>(storeName: keyof DBStores): Promise<T[]> => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES[storeName], "readonly");
      const store = tx.objectStore(STORES[storeName]);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  };

  const words = await getStoreData<Word>("words");
  const stats = await getStoreData<any>("stats");
  const config = await getStoreData<any>("config");
  const settings = await getStoreData<any>("settings");

  return {
    version: DB_VERSION,
    dbName: DB_NAME,
    exportedAt: new Date().toISOString(),
    stores: {
      words,
      stats,
      config,
      settings
    }
  };
}

// Import full IndexedDB database from a JSON object
export async function importIndexedDBDatabase(data: any): Promise<{
  success: boolean;
  message: string;
  recordCounts: { words: number; stats: number; config: number; settings: number };
}> {
  if (!data || typeof data !== "object" || !data.stores) {
    throw new Error("Invalid backup file. Missing 'stores' object.");
  }

  const { stores } = data;
  if (!stores.words || !Array.isArray(stores.words)) {
    throw new Error("Invalid backup file: 'words' array is required.");
  }

  const db = await openDB();

  // Clear and populate words
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.words, "readwrite");
    const store = tx.objectStore(STORES.words);
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      for (const item of stores.words) {
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Clear and populate stats
  if (Array.isArray(stores.stats)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.stats, "readwrite");
      const store = tx.objectStore(STORES.stats);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const item of stores.stats) {
          store.put(item);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Clear and populate config
  if (Array.isArray(stores.config)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.config, "readwrite");
      const store = tx.objectStore(STORES.config);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const item of stores.config) {
          store.put(item);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Clear and populate settings
  if (Array.isArray(stores.settings)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.settings, "readwrite");
      const store = tx.objectStore(STORES.settings);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const item of stores.settings) {
          store.put(item);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    success: true,
    message: "Database restored successfully!",
    recordCounts: {
      words: stores.words ? stores.words.length : 0,
      stats: stores.stats ? stores.stats.length : 0,
      config: stores.config ? stores.config.length : 0,
      settings: stores.settings ? stores.settings.length : 0
    }
  };
}

// Reset IndexedDB to default state
export async function resetIndexedDBDatabase(): Promise<void> {
  const db = await openDB();
  
  // Clear all stores
  const storeNames: (keyof DBStores)[] = ["words", "stats", "config", "settings"];
  for (const name of storeNames) {
    await new Promise<void>((resolve, reject) => {
      if (!db.objectStoreNames.contains(STORES[name])) {
        resolve();
        return;
      }
      const tx = db.transaction(STORES[name], "readwrite");
      const store = tx.objectStore(STORES[name]);
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve();
      clearReq.onerror = () => reject(clearReq.error);
    });
  }

  await saveSettingToDB("db_initialized", "true");
  try {
    localStorage.setItem("vocab_learner_db_initialized", "true");
    localStorage.removeItem("vocab_learner_decks");
    localStorage.removeItem("vocab_learner_decks_backup");
  } catch (e) {}
}

// Clear all words completely without restoring defaults
export async function clearAllWordsAndStatsFromDB(): Promise<void> {
  const db = await openDB();
  const storeNames: (keyof DBStores)[] = ["words", "stats"];
  for (const name of storeNames) {
    await new Promise<void>((resolve, reject) => {
      // check if the store exists before attempting to clear it
      if (!db.objectStoreNames.contains(STORES[name])) {
        resolve();
        return;
      }
      const tx = db.transaction(STORES[name], "readwrite");
      const store = tx.objectStore(STORES[name]);
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve();
      clearReq.onerror = () => reject(clearReq.error);
    });
  }

  await saveSettingToDB("db_initialized", "true");
  try {
    localStorage.setItem("vocab_learner_db_initialized", "true");
    localStorage.removeItem("vocab_learner_decks");
    localStorage.removeItem("vocab_learner_decks_backup");
  } catch (e) {}
}

