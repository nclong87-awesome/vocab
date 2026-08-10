import { sanitizeDataForCloudSync, deduplicateDeletedWords } from "../utils/cloudSyncMerge";
import { IndexedDBExportData } from "../db/indexedDB";
import { fetchWithTimeout } from "../utils";

export interface RateLimitCheckResult {
  allowed: boolean;
  waitSeconds?: number;
  reason?: string;
}

export interface GistSyncOptions {
  isUserAction?: boolean;
}

const GIST_REQUEST_LOG_KEY = "gist_api_request_log";
const LAST_GIST_CALL_KEY = "last_gist_api_call_time";

/**
 * Checks if a Gist API request is allowed according to local-storage rate limit guard.
 */
export function checkGistRateLimit(options: GistSyncOptions = {}): RateLimitCheckResult {
  const isUserAction = options.isUserAction ?? true;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequestsPerWindow = 8; // Maximum 8 Gist requests per minute
  const minIntervalUserMs = 3000; // Minimum 3s between manual user syncs
  const minIntervalBackgroundMs = 15000; // Minimum 15s between background sync checks

  let log: number[] = [];
  try {
    const raw = localStorage.getItem(GIST_REQUEST_LOG_KEY);
    if (raw) {
      log = JSON.parse(raw);
    }
  } catch {
    log = [];
  }

  // Filter log to keep only timestamps within the last 60 seconds
  log = log.filter((ts) => typeof ts === "number" && now - ts < windowMs);

  const lastTs = log.length > 0 ? Math.max(...log) : 0;
  const timeSinceLast = now - lastTs;

  const minInterval = isUserAction ? minIntervalUserMs : minIntervalBackgroundMs;

  if (lastTs > 0 && timeSinceLast < minInterval) {
    const waitSeconds = Math.ceil((minInterval - timeSinceLast) / 1000);
    return {
      allowed: false,
      waitSeconds,
      reason: `Rate limit guard: Please wait ${waitSeconds}s before sending another request to GitHub Gist.`
    };
  }

  if (log.length >= maxRequestsPerWindow) {
    const oldestTs = Math.min(...log);
    const waitSeconds = Math.ceil((windowMs - (now - oldestTs)) / 1000);
    return {
      allowed: false,
      waitSeconds,
      reason: `Rate limit guard: Maximum ${maxRequestsPerWindow} requests per minute reached. Please wait ${waitSeconds}s.`
    };
  }

  return { allowed: true };
}

/**
 * Enforces rate limit check and records request timestamp in local-storage.
 */
export function enforceAndRecordGistRateLimit(options: GistSyncOptions = {}): void {
  const check = checkGistRateLimit(options);
  if (!check.allowed) {
    throw new Error(check.reason || "Rate limit guard: Request blocked to prevent excess requests to GitHub Gist.");
  }

  const now = Date.now();
  const windowMs = 60 * 1000;
  let log: number[] = [];
  try {
    const raw = localStorage.getItem(GIST_REQUEST_LOG_KEY);
    if (raw) {
      log = JSON.parse(raw);
    }
  } catch {
    log = [];
  }

  log = log.filter((ts) => typeof ts === "number" && now - ts < windowMs);
  log.push(now);

  try {
    localStorage.setItem(GIST_REQUEST_LOG_KEY, JSON.stringify(log));
    localStorage.setItem(LAST_GIST_CALL_KEY, String(now));
  } catch {
    /* ignore storage errors */
  }
}

export const syncToGist = async (
  token: string, 
  data: string, 
  gistId?: string,
  options: GistSyncOptions = { isUserAction: true }
): Promise<string> => {
  enforceAndRecordGistRateLimit(options);

  let filesToUpdate: Record<string, any> = {};

  try {
    let existingFiles: Record<string, any> = {};
    if (gistId) {
      try {
        const getResponse = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        if (getResponse.ok) {
          const getResult = await getResponse.json();
          existingFiles = getResult.files || {};
        }
      } catch (e) {
        // Ignore error and proceed
      }
    }

    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && parsed.stores) {
      const sanitized = sanitizeDataForCloudSync(parsed as IndexedDBExportData);
      
      // Clean up legacy files from gist if they exist
      if (gistId) {
        const legacyFilesToCheck = [
          'metadata.json',
          'deleted_words.json',
          'vocab_learner_backup.json'
        ];
        for (const storeName of Object.keys(sanitized.stores)) {
          legacyFilesToCheck.push(`store_${storeName}.json`);
        }
        
        for (const fileToDelete of legacyFilesToCheck) {
          if (existingFiles[fileToDelete]) {
            filesToUpdate[fileToDelete] = null;
          }
        }
      }

      filesToUpdate['VocabLearner_00_metadata.json'] = {
        content: JSON.stringify({
          version: sanitized.version,
          dbName: sanitized.dbName,
          exportedAt: sanitized.exportedAt
        }, null, 2)
      };

      for (const [storeName, storeData] of Object.entries(sanitized.stores)) {
        if (storeName === 'deletedWords') {
          filesToUpdate['VocabLearner_01_deleted_words.json'] = {
            content: JSON.stringify(storeData, null, 2)
          };
        } else {
          let finalStoreData = storeData;
          if (storeName === 'settings' && Array.isArray(storeData)) {
            finalStoreData = (storeData as any[]).filter((s: any) => !s || s.key !== 'deleted_words') as typeof storeData;
          }
          filesToUpdate[`VocabLearner_02_store_${storeName}.json`] = {
            content: JSON.stringify(finalStoreData, null, 2)
          };
        }
      }
    } else {
      throw new Error("Invalid export data format");
    }
  } catch (error) {
    throw new Error("Failed to process local data for sync: " + (error as Error).message);
  }

  const url = gistId 
    ? `https://api.github.com/gists/${gistId}`
    : 'https://api.github.com/gists';
  
  const response = await fetchWithTimeout(url, {
    method: gistId ? 'PATCH' : 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      description: 'VocabLearner Backup',
      public: false,
      files: filesToUpdate
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Failed to sync to GitHub Gist');
  }

  const result = await response.json();
  return result.id;
};

export const syncFromGist = async (
  token: string, 
  gistId: string, 
  options: GistSyncOptions = { isUserAction: true }
): Promise<any> => {
  enforceAndRecordGistRateLimit(options);

  const response = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Failed to read from GitHub Gist');
  }

  const result = await response.json();
  
  // Segmented stores backup check
  const parsedData: any = { stores: {} };
  let hasValidData = false;

  const metadataFile = result.files['VocabLearner_00_metadata.json'] || result.files['metadata.json'];
  if (metadataFile && metadataFile.content) {
    const meta = JSON.parse(metadataFile.content);
    parsedData.version = meta.version;
    parsedData.dbName = meta.dbName;
    parsedData.exportedAt = meta.exportedAt;
    hasValidData = true;
  }

  for (const [filename, fileObj] of Object.entries(result.files)) {
    let storeName = null;
    if (filename.startsWith('VocabLearner_02_store_') && filename.endsWith('.json')) {
      storeName = filename.replace('VocabLearner_02_store_', '').replace('.json', '');
    } else if (filename.startsWith('store_') && filename.endsWith('.json')) {
      storeName = filename.replace('store_', '').replace('.json', '');
    }

    if (storeName) {
      const content = (fileObj as any).content;
      if (content) {
        parsedData.stores[storeName] = JSON.parse(content);
        hasValidData = true;
      }
    }
  }

  const deletedWordsFile = result.files['VocabLearner_01_deleted_words.json'] || result.files['deleted_words.json'];
  if (deletedWordsFile && deletedWordsFile.content) {
    try {
      const deletedWordsContent = JSON.parse(deletedWordsFile.content);
      if (Array.isArray(deletedWordsContent)) {
        parsedData.stores.deletedWords = deduplicateDeletedWords(deletedWordsContent);
      } else if (deletedWordsContent && deletedWordsContent.value) {
        const parsedArr = JSON.parse(deletedWordsContent.value);
        if (Array.isArray(parsedArr)) {
          parsedData.stores.deletedWords = deduplicateDeletedWords(parsedArr);
        }
      }
      hasValidData = true;
    } catch {
      // ignore
    }
  }

  if (hasValidData) {
    return parsedData;
  }

  throw new Error('Backup files not found in Gist');
};
