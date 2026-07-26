import { LLMConfig, LLMProvider, SavedProviderConfig, SavedProvidersMap } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

/**
 * Gets saved providers map from LLMConfig with safety fallbacks
 */
export function getSavedProvidersMap(config: LLMConfig): SavedProvidersMap {
  const map: SavedProvidersMap = config.savedProviders ? { ...config.savedProviders } : {};
  
  // Ensure current active provider is present in map if logged in
  if (config.provider && config.isLoggedIn) {
    if (!map[config.provider] || config.apiKey !== map[config.provider].apiKey || config.model !== map[config.provider].model) {
      map[config.provider] = {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        isLoggedIn: config.isLoggedIn,
        lastUsedAt: new Date().toISOString()
      };
    }
  }

  return map;
}

/**
 * Updates LLMConfig with a new or updated provider profile
 */
export function updateProviderProfile(
  currentConfig: LLMConfig,
  profile: SavedProviderConfig,
  makeActive: boolean = true
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  
  const updatedProfile: SavedProviderConfig = {
    ...profile,
    isLoggedIn: true,
    lastUsedAt: new Date().toISOString()
  };

  savedMap[profile.provider] = updatedProfile;

  if (makeActive) {
    return {
      provider: profile.provider,
      model: profile.model,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl || "",
      isLoggedIn: true,
      savedProviders: savedMap
    };
  }

  return {
    ...currentConfig,
    savedProviders: savedMap
  };
}

/**
 * Switch active provider to a saved or default profile
 */
export function switchActiveProvider(
  currentConfig: LLMConfig,
  targetProviderId: LLMProvider
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  const targetSaved = savedMap[targetProviderId];

  if (targetSaved) {
    const updatedMap = {
      ...savedMap,
      [targetProviderId]: {
        ...targetSaved,
        lastUsedAt: new Date().toISOString()
      }
    };

    return {
      provider: targetProviderId,
      model: targetSaved.model,
      apiKey: targetSaved.apiKey,
      baseUrl: targetSaved.baseUrl || "",
      isLoggedIn: true,
      savedProviders: updatedMap
    };
  }

  // Fallback to provider defaults
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === targetProviderId) || PROVIDER_OPTIONS[0];

  return {
    provider: targetProviderId,
    model: providerMeta.defaultModel,
    apiKey: "",
    baseUrl: providerMeta.defaultBaseUrl || "",
    isLoggedIn: !providerMeta.requiresKey,
    savedProviders: savedMap
  };
}

/**
 * Remove a saved provider profile from LLMConfig
 */
export function removeProviderProfile(
  currentConfig: LLMConfig,
  targetProviderId: LLMProvider
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  delete savedMap[targetProviderId];

  // If we just deleted the active provider, switch active to another saved one or default
  if (currentConfig.provider === targetProviderId) {
    const remainingKeys = Object.keys(savedMap) as LLMProvider[];
    if (remainingKeys.length > 0) {
      const nextKey = remainingKeys[0];
      const nextProfile = savedMap[nextKey];
      return {
        provider: nextKey,
        model: nextProfile.model,
        apiKey: nextProfile.apiKey,
        baseUrl: nextProfile.baseUrl || "",
        isLoggedIn: nextProfile.isLoggedIn,
        savedProviders: savedMap
      };
    } else {
      // Return default unconfigured
      const defaultMeta = PROVIDER_OPTIONS[0];
      return {
        provider: defaultMeta.id,
        model: defaultMeta.defaultModel,
        apiKey: "",
        baseUrl: defaultMeta.defaultBaseUrl || "",
        isLoggedIn: false,
        savedProviders: {}
      };
    }
  }

  return {
    ...currentConfig,
    savedProviders: savedMap
  };
}
