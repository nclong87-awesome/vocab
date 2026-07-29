import { sanitizeDataForCloudSync } from "../utils/cloudSyncMerge";
import { IndexedDBExportData } from "../db/indexedDB";

export const syncToGist = async (token: string, data: string, gistId?: string): Promise<string> => {
  let contentToSend = data;

  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && parsed.stores) {
      const sanitized = sanitizeDataForCloudSync(parsed as IndexedDBExportData);
      contentToSend = JSON.stringify(sanitized);
    }
  } catch {
    // If not valid JSON object, send string as is
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
      files: {
        'vocab_learner_backup.json': {
          content: contentToSend
        }
      }
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
  const file = Object.values(result.files)[0] as any;
  if (!file || !file.content) throw new Error('Backup file not found in Gist');
  
  return JSON.parse(file.content);
};
