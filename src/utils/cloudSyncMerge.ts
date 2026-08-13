import { IndexedDBExportData, StoredRecord, StoredSetting } from "../db/indexedDB";
import { Word, UserStats, StrengthHistoryEntry } from "../types";
import { recalculateWordsMemoryDecay } from "./spacedRepetition";

export interface DeletedWordRecord {
  id: string;
  word: string;
  deletedAt: string;
}

export interface WordDiffItem {
  word: string;
  changes: string[];
}

export interface SyncDiffDetails {
  newLocalWords: Word[];
  newRemoteWords: Word[];
  deletedWordsToSync: Word[];
  updatedWords: WordDiffItem[];
  statsChanged: boolean;
  statsSummary?: {
    quizzesBeforeLocal: number;
    quizzesMerged: number;
    streakBeforeLocal: number;
    streakMerged: number;
  };
  totalMergedWordsCount: number;
}

export interface MergeResult {
  mergedData: IndexedDBExportData;
  hasChanges: boolean;
  diffDetails: SyncDiffDetails;
}

/**
 * Parses ISO date string safely into timestamp number
 */
function parseTime(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Deduplicates deleted word records so each word/ID has at most one tombstone record
 * with the latest `deletedAt` timestamp.
 */
export function deduplicateDeletedWords(records: DeletedWordRecord[]): DeletedWordRecord[] {
  if (!Array.isArray(records) || records.length === 0) return [];

  const uniqueRecords: DeletedWordRecord[] = [];

  for (const rec of records) {
    if (!rec) continue;
    const id = rec.id ? String(rec.id).trim() : "";
    const word = rec.word ? String(rec.word).trim() : "";
    const normWord = word.toLowerCase();

    if (!id && !normWord) continue;

    // Find existing record matching either id or normalized word
    const existingIndex = uniqueRecords.findIndex((existing) => {
      const existingId = existing.id ? String(existing.id).trim() : "";
      const existingNormWord = existing.word ? String(existing.word).trim().toLowerCase() : "";

      const matchId = Boolean(id && existingId && id === existingId);
      const matchWord = Boolean(normWord && existingNormWord && normWord === existingNormWord);

      return matchId || matchWord;
    });

    if (existingIndex >= 0) {
      const existing = uniqueRecords[existingIndex];
      const recTime = parseTime(rec.deletedAt);
      const existingTime = parseTime(existing.deletedAt);
      const newerTime = recTime > existingTime ? rec.deletedAt : existing.deletedAt;

      // Prefer generated word ID (e.g. ai-word-...) or non-empty ID over fallback word string
      let bestId = existing.id || id || normWord;
      if (id && id.startsWith("ai-word-") && (!existing.id || !existing.id.startsWith("ai-word-"))) {
        bestId = id;
      }

      uniqueRecords[existingIndex] = {
        id: bestId,
        word: existing.word || word || "",
        deletedAt: newerTime || new Date().toISOString()
      };
    } else {
      uniqueRecords.push({
        id: id || normWord,
        word: word,
        deletedAt: rec.deletedAt || new Date().toISOString()
      });
    }
  }

  return uniqueRecords;
}

function getDeletedWordsFromExportData(data: IndexedDBExportData): DeletedWordRecord[] {
  let list: DeletedWordRecord[] = [];
  if (Array.isArray(data.stores?.deletedWords) && data.stores.deletedWords.length > 0) {
    list = data.stores.deletedWords;
  } else {
    const settingRec = data.stores?.settings?.find((s) => s && s.key === "deletedwords");
    if (settingRec && settingRec.value) {
      try {
        const parsed = JSON.parse(settingRec.value);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    }
  }
  return deduplicateDeletedWords(list);
}

/**
 * Calculates merged dataset between local and remote backups based on timestamps and record IDs.
 */
export function autoMergeLocalAndRemote(
  localData: IndexedDBExportData,
  remoteData: IndexedDBExportData
): MergeResult {
  const now = new Date();
  const rawLocalWords: Word[] = localData.stores?.words || [];
  const rawRemoteWords: Word[] = remoteData.stores?.words || [];

  // Evaluate memory decay on both local and remote words at the exact same point in time ("now")
  const { updatedWords: localWords } = recalculateWordsMemoryDecay(rawLocalWords, now);
  const { updatedWords: remoteWords } = recalculateWordsMemoryDecay(rawRemoteWords, now);

  const newLocalWords: Word[] = [];
  const newRemoteWords: Word[] = [];
  const deletedWordsToSync: Word[] = [];
  const updatedWords: WordDiffItem[] = [];
  const mergedWordsMap = new Map<string, Word>();

  // Extract tombstones & timestamps
  const localDeleted = getDeletedWordsFromExportData(localData);
  const remoteDeleted = getDeletedWordsFromExportData(remoteData);

  const mergedDeletedList = deduplicateDeletedWords([...localDeleted, ...remoteDeleted]);

  // Fast O(1) tombstone lookup map by ID or normalized word
  const tombstoneLookupMap = new Map<string, DeletedWordRecord>();
  for (const d of mergedDeletedList) {
    if (d.id) tombstoneLookupMap.set(d.id.trim(), d);
    if (d.word) tombstoneLookupMap.set(d.word.trim().toLowerCase(), d);
  }

  const localExportTime = parseTime(localData.exportedAt);
  const remoteExportTime = parseTime(remoteData.exportedAt);

  // Map words by key (case-insensitive word string or ID)
  const remoteWordMap = new Map<string, Word>();
  const remoteByIdMap = new Map<string, Word>();

  for (const rWord of remoteWords) {
    if (rWord.id) remoteByIdMap.set(rWord.id, rWord);
    if (rWord.word) remoteWordMap.set(rWord.word.trim().toLowerCase(), rWord);
  }

  const processedRemoteKeys = new Set<string>();

  // 1. Process Local Words vs Remote Words
  for (const lWord of localWords) {
    const normKey = lWord.word ? lWord.word.trim().toLowerCase() : "";
    const matchByKey = remoteWordMap.get(normKey);
    const matchById = remoteByIdMap.get(lWord.id);
    const match = matchById || matchByKey;

    // Check if lWord was deleted on remote
    const tombstone = (lWord.id && tombstoneLookupMap.get(lWord.id.trim())) || (normKey && tombstoneLookupMap.get(normKey));
    const lUpdatedTime = Math.max(parseTime(lWord.lastReviewed), parseTime(lWord.createdAt));

    let isDeletedOnRemote = false;
    if (tombstone) {
      const deletedTime = parseTime(tombstone.deletedAt);
      if (lUpdatedTime <= deletedTime && !match) {
        isDeletedOnRemote = true;
      }
    }

    if (isDeletedOnRemote) {
      deletedWordsToSync.push(lWord);
      if (!tombstone) {
        const newRec: DeletedWordRecord = {
          id: lWord.id || normKey,
          word: lWord.word || "",
          deletedAt: new Date(remoteExportTime || Date.now()).toISOString()
        };
        mergedDeletedList.push(newRec);
        if (lWord.id) tombstoneLookupMap.set(lWord.id.trim(), newRec);
        if (normKey) tombstoneLookupMap.set(normKey, newRec);
      }
      continue;
    }

    if (!match) {
      // Local word missing in remote
      newLocalWords.push(lWord);
      mergedWordsMap.set(lWord.id || `local-${normKey}`, lWord);
    } else {
      // Record key processed
      if (match.id) processedRemoteKeys.add(match.id);
      if (match.word) processedRemoteKeys.add(match.word.trim().toLowerCase());

      // Compare local vs remote timestamps & properties
      const localReviewTime = Math.max(parseTime(lWord.lastReviewed), parseTime(lWord.createdAt));
      const remoteReviewTime = Math.max(parseTime(match.lastReviewed), parseTime(match.createdAt));

      // Choose base record from whichever was updated / reviewed most recently
      const baseIsLocal = localReviewTime >= remoteReviewTime;
      const primary = baseIsLocal ? lWord : match;

      // Merge combined fields:
      // - Starred: if starred anywhere, keep true
      const mergedStarred = Boolean(lWord.starred || match.starred);

      const lEffectiveStrength = lWord.strength ?? (lWord.learned ? 100 : 0);
      const rEffectiveStrength = match.strength ?? (match.learned ? 100 : 0);

      // Merge and deduplicate strengthHistory arrays
      const localHistory = lWord.strengthHistory || [];
      const remoteHistory = match.strengthHistory || [];

      const historyMap = new Map<string, StrengthHistoryEntry>();
      for (const entry of [...localHistory, ...remoteHistory]) {
        if (entry) {
          const key = entry.id || `${entry.timestamp || ""}-${entry.reason || ""}-${entry.strength ?? 0}`;
          const existing = historyMap.get(key);
          if (!existing) {
            historyMap.set(key, entry);
          } else {
            const existingTime = parseTime(existing.timestamp);
            const entryTime = parseTime(entry.timestamp);
            if (entryTime > existingTime || (entryTime === existingTime && (entry.strength ?? 0) > (existing.strength ?? 0))) {
              historyMap.set(key, entry);
            }
          }
        }
      }

      const rawMergedHistory = Array.from(historyMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Deduplicate adjacent memory_decay entries with identical strength
      const mergedHistoryList: StrengthHistoryEntry[] = [];
      for (const entry of rawMergedHistory) {
        const last = mergedHistoryList[mergedHistoryList.length - 1];
        if (
          last &&
          entry.reason === "memory_decay" &&
          last.reason === "memory_decay" &&
          entry.strength === last.strength
        ) {
          continue;
        }
        mergedHistoryList.push(entry);
      }

      // Determine strength and learned status:
      let mergedStrength = Math.max(lEffectiveStrength, rEffectiveStrength);
      let mergedLearned = Boolean(lWord.learned || match.learned || mergedStrength >= 80);

      if (mergedHistoryList.length > 0) {
        const latestEntry = mergedHistoryList[mergedHistoryList.length - 1];
        if (latestEntry.reason === "memory_decay") {
          mergedStrength = latestEntry.strength;
          mergedLearned = mergedStrength >= 80;
        } else if (latestEntry.reason === "mastered") {
          mergedStrength = Math.max(80, latestEntry.strength);
          mergedLearned = true;
        } else {
          mergedStrength = latestEntry.strength;
          mergedLearned = mergedStrength >= 80 ? true : Boolean(lWord.learned || match.learned);
        }
      } else {
        if (localReviewTime > remoteReviewTime) {
          mergedStrength = lEffectiveStrength;
          mergedLearned = Boolean(lWord.learned || mergedStrength >= 80);
        } else if (remoteReviewTime > localReviewTime) {
          mergedStrength = rEffectiveStrength;
          mergedLearned = Boolean(match.learned || mergedStrength >= 80);
        }
      }

      const mergedWordItem: Word = {
        ...primary,
        id: lWord.id || match.id,
        starred: mergedStarred,
        strength: mergedStrength,
        learned: mergedLearned,
        lastReviewed: localReviewTime >= remoteReviewTime ? lWord.lastReviewed : match.lastReviewed,
        createdAt: parseTime(lWord.createdAt) < parseTime(match.createdAt) && parseTime(lWord.createdAt) > 0 ? lWord.createdAt : match.createdAt,
        strengthHistory: mergedHistoryList.length > 0 ? mergedHistoryList : undefined
      };

      // Detect differences
      const changesList: string[] = [];
      if (Boolean(lWord.starred) !== Boolean(match.starred)) {
        changesList.push(`Starred status synced (${mergedStarred ? "Starred" : "Unstarred"})`);
      }
      
      if (lEffectiveStrength !== rEffectiveStrength) {
        changesList.push(`Strength level merged (${lEffectiveStrength} vs ${rEffectiveStrength} → ${mergedStrength})`);
      }
      if (Boolean(lWord.learned) !== Boolean(match.learned)) {
        changesList.push(`Mastery synced (${mergedLearned ? "Mastered" : "Learning"})`);
      }
      if (localHistory.length !== mergedHistoryList.length && remoteHistory.length !== mergedHistoryList.length) {
        changesList.push(`Strength history synced (${localHistory.length} vs ${remoteHistory.length} entries)`);
      }

      if ((lWord.definition || "").trim() !== (match.definition || "").trim()) {
        changesList.push(`Definition updated from latest edit`);
      }

      if (changesList.length > 0) {
        updatedWords.push({
          word: mergedWordItem.word,
          changes: changesList
        });
      }

      mergedWordsMap.set(mergedWordItem.id, mergedWordItem);
    }
  }

  // 2. Process Remote Words missing in Local
  for (const rWord of remoteWords) {
    const normKey = rWord.word ? rWord.word.trim().toLowerCase() : "";
    const rId = rWord.id;
    const isProcessed = (rId && processedRemoteKeys.has(rId)) || (normKey && processedRemoteKeys.has(normKey));
    if (isProcessed) continue;

    // Check if rWord was deleted on local
    const tombstone = (rId && tombstoneLookupMap.get(rId.trim())) || (normKey && tombstoneLookupMap.get(normKey));
    const rUpdatedTime = Math.max(parseTime(rWord.lastReviewed), parseTime(rWord.createdAt));

    let isDeletedOnLocal = false;
    if (tombstone) {
      const deletedTime = parseTime(tombstone.deletedAt);
      if (rUpdatedTime <= deletedTime) {
        isDeletedOnLocal = true;
      }
    }

    if (isDeletedOnLocal) {
      deletedWordsToSync.push(rWord);
      if (!tombstone) {
        const newRec: DeletedWordRecord = {
          id: rId || normKey,
          word: rWord.word || "",
          deletedAt: new Date(localExportTime || Date.now()).toISOString()
        };
        mergedDeletedList.push(newRec);
        if (rId) tombstoneLookupMap.set(rId.trim(), newRec);
        if (normKey) tombstoneLookupMap.set(normKey, newRec);
      }
    } else {
      newRemoteWords.push(rWord);
      mergedWordsMap.set(rWord.id || `remote-${normKey}`, rWord);
    }
  }

  const mergedWordsList = Array.from(mergedWordsMap.values());

  // 3. Merge Stats
  const localStatsRec = localData.stores?.stats?.[0];
  const remoteStatsRec = remoteData.stores?.stats?.[0];

  const localStats: UserStats = localStatsRec?.data || {
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  };

  const remoteStats: UserStats = remoteStatsRec?.data || {
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  };

  const mergedQuizzesTaken = Math.max(localStats.totalQuizzesTaken || 0, remoteStats.totalQuizzesTaken || 0);
  const mergedCorrectAnswers = Math.max(localStats.totalCorrectAnswers || 0, remoteStats.totalCorrectAnswers || 0);

  // Streak logic: take the higher streak or most recent streak date
  const localStreakCount = localStats.streak?.count || 0;
  const remoteStreakCount = remoteStats.streak?.count || 0;
  const localStreakTime = parseTime(localStats.streak?.lastActiveDate);
  const remoteStreakTime = parseTime(remoteStats.streak?.lastActiveDate);

  let mergedStreakCount = Math.max(localStreakCount, remoteStreakCount);
  let mergedStreakDate = localStreakTime >= remoteStreakTime ? localStats.streak?.lastActiveDate || "" : remoteStats.streak?.lastActiveDate || "";
  const mergedHistory = Array.from(new Set([...(localStats.streak?.history || []), ...(remoteStats.streak?.history || [])]));

  const statsChanged =
    (localStats.totalQuizzesTaken || 0) !== mergedQuizzesTaken ||
    (localStats.totalCorrectAnswers || 0) !== mergedCorrectAnswers ||
    localStreakCount !== mergedStreakCount;

  const mergedStatsRec: StoredRecord<UserStats> = {
    id: localStatsRec?.id || "user_stats",
    data: {
      totalQuizzesTaken: mergedQuizzesTaken,
      totalCorrectAnswers: mergedCorrectAnswers,
      streak: {
        count: mergedStreakCount,
        lastActiveDate: mergedStreakDate,
        history: mergedHistory
      }
    },
    updatedAt: new Date().toISOString()
  };

  // 4. Merge Config & Settings (Preserve local API keys)
  const localConfigList = localData.stores?.config || [];
  const remoteConfigList = remoteData.stores?.config || [];
  const mergedConfigMap = new Map<string, StoredRecord<any>>();

  for (const rRec of remoteConfigList) {
    if (rRec && rRec.id) {
      mergedConfigMap.set(rRec.id, JSON.parse(JSON.stringify(rRec)));
    }
  }

  for (const lRec of localConfigList) {
    if (!lRec || !lRec.id) continue;
    const existing = mergedConfigMap.get(lRec.id);
    if (!existing) {
      mergedConfigMap.set(lRec.id, JSON.parse(JSON.stringify(lRec)));
    } else {
      const mergedRecData = { ...existing.data, ...lRec.data };
      if ((lRec.data as any)?.apiKey) {
        mergedRecData.apiKey = (lRec.data as any).apiKey;
      }
      if ((lRec.data as any)?.savedProviders && (existing.data as any)?.savedProviders) {
        const mergedProviders = { ...(existing.data as any).savedProviders };
        for (const [pKey, pVal] of Object.entries((lRec.data as any).savedProviders as Record<string, any>)) {
          if (pVal && typeof pVal === "object") {
            const existingP = mergedProviders[pKey] || {};
            mergedProviders[pKey] = {
              ...existingP,
              ...pVal,
              apiKey: pVal.apiKey || existingP.apiKey || ""
            };
          }
        }
        mergedRecData.savedProviders = mergedProviders;
      }
      mergedConfigMap.set(lRec.id, { ...existing, ...lRec, data: mergedRecData });
    }
  }

  const mergedConfig = Array.from(mergedConfigMap.values());
  const localSettings = (localData.stores?.settings || []).filter((s) => !s || s.key !== "deletedwords");
  const remoteSettings = (remoteData.stores?.settings || []).filter((s) => !s || s.key !== "deletedwords");

  const settingsMap = new Map<string, StoredSetting>();
  for (const s of remoteSettings) if (s && s.key) settingsMap.set(s.key, s);
  for (const s of localSettings) if (s && s.key) settingsMap.set(s.key, s);

  const activeWordKeys = new Set<string>();
  for (const w of mergedWordsList) {
    if (w.id) activeWordKeys.add(w.id.trim());
    if (w.word) activeWordKeys.add(w.word.trim().toLowerCase());
  }

  const finalMergedDeletedList = deduplicateDeletedWords(
    mergedDeletedList.filter(d => {
      if (!d) return false;
      const dId = d.id ? d.id.trim() : "";
      const dWord = d.word ? d.word.trim().toLowerCase() : "";
      const isActive = (dId && activeWordKeys.has(dId)) || (dWord && activeWordKeys.has(dWord));
      return !isActive;
    })
  );
  const mergedSettings = Array.from(settingsMap.values());

  const mergedExportData: IndexedDBExportData = {
    version: localData.version || 1,
    dbName: localData.dbName || "VocabLearnerDB",
    exportedAt: new Date().toISOString(),
    stores: {
      words: mergedWordsList,
      stats: [mergedStatsRec],
      config: mergedConfig,
      settings: mergedSettings,
      deletedWords: finalMergedDeletedList
    }
  };

  const hasChanges =
    newLocalWords.length > 0 ||
    newRemoteWords.length > 0 ||
    deletedWordsToSync.length > 0 ||
    updatedWords.length > 0 ||
    statsChanged;

  return {
    mergedData: mergedExportData,
    hasChanges,
    diffDetails: {
      newLocalWords,
      newRemoteWords,
      deletedWordsToSync,
      updatedWords,
      statsChanged,
      statsSummary: {
        quizzesBeforeLocal: localStats.totalQuizzesTaken || 0,
        quizzesMerged: mergedQuizzesTaken,
        streakBeforeLocal: localStreakCount,
        streakMerged: mergedStreakCount
      },
      totalMergedWordsCount: mergedWordsList.length
    }
  };
}

/**
 * Sanitizes exported IndexedDB data by stripping API keys and secret tokens
 * before sending to cloud storage (e.g. GitHub Gist).
 */
export function sanitizeDataForCloudSync(data: IndexedDBExportData): IndexedDBExportData {
  if (!data || !data.stores) return data;

  const storesCopy = {
    words: data.stores.words ? [...data.stores.words] : [],
    stats: data.stores.stats ? JSON.parse(JSON.stringify(data.stores.stats)) : [],
    config: data.stores.config ? JSON.parse(JSON.stringify(data.stores.config)) : [],
    settings: data.stores.settings ? JSON.parse(JSON.stringify(data.stores.settings)) : [],
    deletedWords: data.stores.deletedWords ? deduplicateDeletedWords(data.stores.deletedWords) : []
  };

  // 1. Sanitize config store (LLMConfig and TTSConfig)
  if (Array.isArray(storesCopy.config)) {
    storesCopy.config = storesCopy.config.map((rec: any) => {
      if (!rec || !rec.data) return rec;

      const recData = JSON.parse(JSON.stringify(rec.data));

      if (typeof recData.apiKey === "string") {
        recData.apiKey = "";
      }
      delete recData.proxyKey;

      if (recData.savedProviders && typeof recData.savedProviders === "object") {
        const sanitizedProviders: Record<string, any> = {};
        for (const [pKey, pVal] of Object.entries(recData.savedProviders)) {
          if (pVal && typeof pVal === "object") {
            const providerCopy = { ...(pVal as any) };
            delete providerCopy.proxyKey;
            providerCopy.apiKey = "";
            sanitizedProviders[pKey] = providerCopy;
          } else {
            sanitizedProviders[pKey] = pVal;
          }
        }
        recData.savedProviders = sanitizedProviders;
      }

      return { ...rec, data: recData };
    });
  }

  // 2. Sanitize settings store
  if (Array.isArray(storesCopy.settings)) {
    storesCopy.settings = storesCopy.settings.filter((s: any) => {
      if (!s || !s.key) return false;
      const lowerKey = s.key.toLowerCase();
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("proxy") ||
        lowerKey === "github_gist_token"
      ) {
        return false;
      }
      return true;
    });
  }

  return {
    ...data,
    stores: storesCopy
  };
}
