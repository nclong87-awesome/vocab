import { IndexedDBExportData, StoredRecord, StoredSetting } from "../db/indexedDB";
import { Word, UserStats, LLMConfig, TTSConfig } from "../types";

export interface WordDiffItem {
  word: string;
  changes: string[];
}

export interface SyncDiffDetails {
  newLocalWords: Word[];
  newRemoteWords: Word[];
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
 * Calculates merged dataset between local and remote backups based on timestamps and record IDs.
 */
export function autoMergeLocalAndRemote(
  localData: IndexedDBExportData,
  remoteData: IndexedDBExportData
): MergeResult {
  const localWords: Word[] = localData.stores?.words || [];
  const remoteWords: Word[] = remoteData.stores?.words || [];

  const newLocalWords: Word[] = [];
  const newRemoteWords: Word[] = [];
  const updatedWords: WordDiffItem[] = [];
  const mergedWordsMap = new Map<string, Word>();

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
    const match = matchById || matchKeyMatch(matchByKey, lWord);

    function matchKeyMatch(keyMatch?: Word, target?: Word): Word | undefined {
      if (!keyMatch) return undefined;
      // If words match textually, consider them the same word
      return keyMatch;
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
      const secondary = baseIsLocal ? match : lWord;

      // Merge combined fields:
      // - Starred: if starred anywhere, keep true
      // - Learned: if learned anywhere with higher strength, take highest
      // - Strength: max strength or from most recent review
      const mergedStarred = Boolean(lWord.starred || match.starred);
      const mergedStrength = Math.max(lWord.strength ?? 0, match.strength ?? 0);
      const mergedLearned = mergedStrength >= 3 || lWord.learned || match.learned;

      const mergedWordItem: Word = {
        ...primary,
        id: lWord.id || match.id,
        starred: mergedStarred,
        strength: mergedStrength,
        learned: mergedLearned,
        lastReviewed: localReviewTime >= remoteReviewTime ? lWord.lastReviewed : match.lastReviewed,
        createdAt: parseTime(lWord.createdAt) < parseTime(match.createdAt) && parseTime(lWord.createdAt) > 0 ? lWord.createdAt : match.createdAt
      };

      // Detect differences
      const changesList: string[] = [];
      if (lWord.starred !== match.starred) {
        changesList.push(`Starred status synced (${mergedStarred ? "Starred" : "Unstarred"})`);
      }
      if ((lWord.strength ?? 0) !== (match.strength ?? 0)) {
        changesList.push(`Strength level merged (${lWord.strength ?? 0} vs ${match.strength ?? 0} → ${mergedStrength})`);
      }
      if (lWord.learned !== match.learned) {
        changesList.push(`Mastery synced (${mergedLearned ? "Mastered" : "Learning"})`);
      }
      if (lWord.definition !== match.definition) {
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
    const isProcessed = (rWord.id && processedRemoteKeys.has(rWord.id)) || (normKey && processedRemoteKeys.has(normKey));
    if (!isProcessed) {
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
    totalWordsMastered: 0,
    totalWordsStudied: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  };

  const remoteStats: UserStats = remoteStatsRec?.data || {
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    totalWordsMastered: 0,
    totalWordsStudied: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  };

  const mergedQuizzesTaken = Math.max(localStats.totalQuizzesTaken || 0, remoteStats.totalQuizzesTaken || 0);
  const mergedCorrectAnswers = Math.max(localStats.totalCorrectAnswers || 0, remoteStats.totalCorrectAnswers || 0);

  // Recalculate word mastery stats from the newly merged words array
  const mergedWordsMastered = mergedWordsList.filter(w => w.learned || (w.strength ?? 0) >= 3).length;
  const mergedWordsStudied = mergedWordsList.filter(w => w.lastReviewed !== null || (w.strength ?? 0) > 0).length;

  // Streak logic: take the higher streak or most recent streak date
  const localStreakCount = localStats.streak?.count || 0;
  const remoteStreakCount = remoteStats.streak?.count || 0;
  const localStreakTime = parseTime(localStats.streak?.lastActiveDate);
  const remoteStreakTime = parseTime(remoteStats.streak?.lastActiveDate);

  let mergedStreakCount = Math.max(localStreakCount, remoteStreakCount);
  let mergedStreakDate = localStreakTime >= remoteStreakTime ? localStats.streak?.lastActiveDate || "" : remoteStats.streak?.lastActiveDate || "";
  const mergedHistory = Array.from(new Set([...(localStats.streak?.history || []), ...(remoteStats.streak?.history || [])]));

  const statsChanged =
    localStats.totalQuizzesTaken !== mergedQuizzesTaken ||
    localStats.totalCorrectAnswers !== mergedCorrectAnswers ||
    localStreakCount !== mergedStreakCount;

  const mergedStatsRec: StoredRecord<UserStats> = {
    id: localStatsRec?.id || "user_stats",
    data: {
      totalQuizzesTaken: mergedQuizzesTaken,
      totalCorrectAnswers: mergedCorrectAnswers,
      totalWordsMastered: mergedWordsMastered,
      totalWordsStudied: mergedWordsStudied,
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
  const localSettings = localData.stores?.settings || [];
  const remoteSettings = remoteData.stores?.settings || [];

  const settingsMap = new Map<string, StoredSetting>();
  for (const s of remoteSettings) if (s && s.key) settingsMap.set(s.key, s);
  for (const s of localSettings) if (s && s.key) settingsMap.set(s.key, s); // Local overrides settings if newer

  const mergedSettings = Array.from(settingsMap.values());

  const mergedExportData: IndexedDBExportData = {
    version: localData.version || 1,
    dbName: localData.dbName || "VocabLearnerDB",
    exportedAt: new Date().toISOString(),
    stores: {
      words: mergedWordsList,
      stats: [mergedStatsRec],
      config: mergedConfig,
      settings: mergedSettings
    }
  };

  const hasChanges =
    newLocalWords.length > 0 ||
    newRemoteWords.length > 0 ||
    updatedWords.length > 0 ||
    statsChanged;

  return {
    mergedData: mergedExportData,
    hasChanges,
    diffDetails: {
      newLocalWords,
      newRemoteWords,
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
    settings: data.stores.settings ? JSON.parse(JSON.stringify(data.stores.settings)) : []
  };

  // 1. Sanitize config store (LLMConfig and TTSConfig)
  if (Array.isArray(storesCopy.config)) {
    storesCopy.config = storesCopy.config.map((rec: any) => {
      if (!rec || !rec.data) return rec;

      const recData = JSON.parse(JSON.stringify(rec.data));

      if (typeof recData.apiKey === "string") {
        recData.apiKey = "";
      }

      if (recData.savedProviders && typeof recData.savedProviders === "object") {
        const sanitizedProviders: Record<string, any> = {};
        for (const [pKey, pVal] of Object.entries(recData.savedProviders)) {
          if (pVal && typeof pVal === "object") {
            sanitizedProviders[pKey] = {
              ...(pVal as object),
              apiKey: ""
            };
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
