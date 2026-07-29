import { sanitizeDataForCloudSync } from "../utils/cloudSyncMerge";
import { IndexedDBExportData } from "../db/indexedDB";

export const syncToGist = async (token: string, data: string, gistId?: string): Promise<string> => {
  let filesToUpdate: Record<string, any> = {};

  try {
    let existingFiles: Record<string, any> = {};
    if (gistId) {
      try {
        const getResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
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
        let finalStoreData = storeData;
        if (storeName === 'settings' && Array.isArray(storeData)) {
          const deletedWords = storeData.find(s => s && s.key === 'deleted_words');
          if (deletedWords) {
            filesToUpdate['VocabLearner_01_deleted_words.json'] = {
              content: JSON.stringify(deletedWords, null, 2)
            };
            finalStoreData = storeData.filter(s => !s || s.key !== 'deleted_words');
          }
        }
        filesToUpdate[`VocabLearner_02_store_${storeName}.json`] = {
          content: JSON.stringify(finalStoreData, null, 2)
        };
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
  
  const response = await fetch(url, {
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

export const syncFromGist = async (token: string, gistId: string): Promise<any> => {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
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
    const deletedWordsContent = JSON.parse(deletedWordsFile.content);
    if (!parsedData.stores.settings) {
      parsedData.stores.settings = [];
    }
    parsedData.stores.settings.push(deletedWordsContent);
    hasValidData = true;
  }

  if (hasValidData) {
    return parsedData;
  }

  throw new Error('Backup files not found in Gist');
};
