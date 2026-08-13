import { sanitizeDataForCloudSync, deduplicateDeletedWords } from "../utils/cloudSyncMerge";
import { IndexedDBExportData } from "../db/indexedDB";
import { fetchWithTimeout, isStaticHost, getStoredAccessCode } from "../utils";

export function getGistEndpointAndHeaders(token?: string, gistId?: string) {
  const isDirectGitHubPat = Boolean(token && (token.startsWith("ghp_") || token.startsWith("github_pat_")));

  const baseUrl = isDirectGitHubPat
    ? "https://api.github.com/gists"
    : isStaticHost() ? "https://storage.nclong87.workers.dev/gists" : "/api/gist";

  const url = gistId ? `${baseUrl}/${gistId}` : baseUrl;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (isDirectGitHubPat) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    // Inject proxy key into header for Worker
    const proxyKeyToUse = (token && !token.startsWith("http")) ? token : getStoredAccessCode();

    if (proxyKeyToUse) {
      headers['X-Proxy-Key'] = proxyKeyToUse;
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return { url, headers };
}

export const syncToGist = async (
  token: string = "", 
  data: string, 
  gistId?: string
): Promise<string> => {
  console.log("[Sync Service] [syncToGist] Starting synchronization. GistID:", gistId || "None (New Gist)");
  let filesToUpdate: Record<string, any> = {};

  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && parsed.stores) {
      const sanitized = sanitizeDataForCloudSync(parsed as IndexedDBExportData);
      console.log("[Sync Service] [syncToGist] Data successfully sanitized for cloud sync.", {
        version: sanitized.version,
        dbName: sanitized.dbName,
        exportedAt: sanitized.exportedAt,
        storesCount: Object.keys(sanitized.stores || {}).length
      });
      
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

      console.log("[Sync Service] [syncToGist] Prepared files payload details:");
      Object.keys(filesToUpdate).forEach(filename => {
        const fileContent = filesToUpdate[filename]?.content;
        const size = fileContent ? fileContent.length : 0;
        console.log(` - File: ${filename} (Size: ${size} chars, Action: ${fileContent ? "Create/Update" : "Delete"})`);
      });

    } else {
      throw new Error("Invalid export data format");
    }
  } catch (error) {
    console.error("[Sync Service] [syncToGist] Failed to process payload:", error);
    throw new Error("Failed to process local data for sync: " + (error as Error).message);
  }

  const { url, headers } = getGistEndpointAndHeaders(token, gistId);
  const isDirectGitHubPat = Boolean(token && (token.startsWith("ghp_") || token.startsWith("github_pat_")));
  const methodToUse = (isDirectGitHubPat && !gistId) ? 'POST' : 'PATCH';
  
  // Create sanitized headers log to avoid leaking secrets
  const safeHeaders: Record<string, string> = { ...headers };
  if (safeHeaders['Authorization']) {
    safeHeaders['Authorization'] = safeHeaders['Authorization'].substring(0, 15) + "... [REDACTED]";
  }
  if (safeHeaders['X-Proxy-Key']) {
    safeHeaders['X-Proxy-Key'] = safeHeaders['X-Proxy-Key'].substring(0, 5) + "... [REDACTED]";
  }

  console.log("[Sync Service] [syncToGist] Dispatching HTTP request:", {
    url,
    method: methodToUse,
    headers: safeHeaders,
  });

  const requestBody = JSON.stringify({
    description: 'VocabLearner Backup',
    public: false,
    files: filesToUpdate
  });

  console.log("[Sync Service] [syncToGist] Full Payload Size:", requestBody.length, "characters");

  try {
    const response = await fetchWithTimeout(url, {
      method: methodToUse,
      headers,
      body: requestBody
    });

    console.log("[Sync Service] [syncToGist] Received Response status:", response.status, response.statusText);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      console.error("[Sync Service] [syncToGist] Request failed with error response:", err);
      throw new Error(err.message || 'Failed to sync to GitHub Gist');
    }

    const result = await response.json();
    console.log("[Sync Service] [syncToGist] Request succeeded. Returned Gist ID:", result.id);
    activeGistFetches.clear();
    return result.id;
  } catch (fetchError: any) {
    console.error("[Sync Service] [syncToGist] Net/HTTP Error during fetch:", fetchError);
    throw fetchError;
  }
};

// Active request coalescing map to prevent simultaneous duplicate HTTP requests
const activeGistFetches = new Map<string, Promise<any>>();

export const syncFromGist = async (
  token: string = "", 
  gistId: string,
  forceRefresh: boolean = false
): Promise<any> => {
  const cacheKey = `${token || ""}_${gistId}`;
  if (forceRefresh) {
    activeGistFetches.delete(cacheKey);
  } else if (activeGistFetches.has(cacheKey)) {
    console.log("[Sync Service] [syncFromGist] Coalescing simultaneous fetch request for Gist ID:", gistId);
    return activeGistFetches.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const { url, headers } = getGistEndpointAndHeaders(token, gistId);

      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || 'Failed to read from GitHub Gist');
      }

      const result = await response.json();
      if (!result || !result.files || Object.keys(result.files).length === 0) {
        throw new Error('Gist files empty or not found');
      }

      const getFileContent = async (fileObj: any): Promise<string | null> => {
        if (!fileObj) return null;
        if (fileObj.truncated && fileObj.raw_url) {
          const rawRes = await fetchWithTimeout(fileObj.raw_url);
          if (!rawRes.ok) {
            throw new Error(`Failed to fetch truncated file raw content (${rawRes.status})`);
          }
          return await rawRes.text();
        }
        if (fileObj.content !== undefined && fileObj.content !== null) {
          return fileObj.content;
        }
        return null;
      };

      // Segmented stores backup check
      const parsedData: any = { stores: {} };
      let hasValidData = false;

      // Identify stores present in new format (VocabLearner_02_store_*.json)
      const newFormatStoreNames = new Set<string>();
      for (const filename of Object.keys(result.files)) {
        if (filename.startsWith('VocabLearner_02_store_') && filename.endsWith('.json')) {
          const sName = filename.replace('VocabLearner_02_store_', '').replace('.json', '');
          if (sName) newFormatStoreNames.add(sName);
        }
      }

      const metadataFile = result.files['VocabLearner_00_metadata.json'];
      if (metadataFile) {
        const metaContent = await getFileContent(metadataFile);
        if (metaContent) {
          try {
            const meta = JSON.parse(metaContent);
            parsedData.version = meta.version;
            parsedData.dbName = meta.dbName;
            parsedData.exportedAt = meta.exportedAt;
            hasValidData = true;
          } catch (e) {
            console.error("Error parsing metadata file from gist:", e);
          }
        }
      }

      for (const [filename, fileObj] of Object.entries(result.files)) {
        let storeName = null;
        let isNewFormat = false;

        if (filename.startsWith('VocabLearner_02_store_') && filename.endsWith('.json')) {
          storeName = filename.replace('VocabLearner_02_store_', '').replace('.json', '');
          isNewFormat = true;
        } else if (filename.startsWith('store_') && filename.endsWith('.json')) {
          storeName = filename.replace('store_', '').replace('.json', '');
          isNewFormat = false;
        }

        if (storeName) {
          // CRITICAL FIX: If a new format file exists for this store, skip legacy store_ file to avoid overwriting newer data!
          if (!isNewFormat && newFormatStoreNames.has(storeName)) {
            continue;
          }

          const content = await getFileContent(fileObj);
          if (content) {
            try {
              parsedData.stores[storeName] = JSON.parse(content);
              hasValidData = true;
            } catch (e) {
              console.error(`Error parsing ${filename} from gist:`, e);
            }
          }
        }
      }

      const deletedWordsFile = result.files['VocabLearner_01_deleted_words.json'];
      if (deletedWordsFile) {
        const deletedWordsContentStr = await getFileContent(deletedWordsFile);
        if (deletedWordsContentStr) {
          try {
            const deletedWordsContent = JSON.parse(deletedWordsContentStr);
            if (Array.isArray(deletedWordsContent)) {
              parsedData.stores.deletedWords = deduplicateDeletedWords(deletedWordsContent);
            } else if (deletedWordsContent && deletedWordsContent.value) {
              const parsedArr = JSON.parse(deletedWordsContent.value);
              if (Array.isArray(parsedArr)) {
                parsedData.stores.deletedWords = deduplicateDeletedWords(parsedArr);
              }
            }
            hasValidData = true;
          } catch (e) {
            console.error("Error parsing deletedWords from gist:", e);
          }
        }
      }

      if (hasValidData && Object.keys(parsedData.stores).length > 0) {
        return parsedData;
      }

      throw new Error('Backup files not found in Gist');
    } finally {
      activeGistFetches.delete(cacheKey);
    }
  })();

  activeGistFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
};
