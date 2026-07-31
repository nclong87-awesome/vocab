import { LLMConfig, LLMProvider, SavedProviderConfig, SavedProvidersMap } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

/**
 * Gets saved providers map from LLMConfig with safety fallbacks
 * Automatically shares proxyKey across all providers if present
 */
export function getSavedProvidersMap(config: LLMConfig): SavedProvidersMap {
  const map: SavedProvidersMap = config.savedProviders ? { ...config.savedProviders } : {};
  
  // Find single shared proxyKey from config or any saved provider profile
  const sharedProxyKey = config.proxyKey || Object.values(map).find(p => Boolean(p?.proxyKey))?.proxyKey || "";

  // Ensure current active provider is present in map if logged in
  if (config.provider && config.isLoggedIn) {
    if (
      !map[config.provider] || 
      config.apiKey !== map[config.provider].apiKey || 
      (sharedProxyKey && config.proxyKey !== map[config.provider].proxyKey) ||
      config.model !== map[config.provider].model
    ) {
      map[config.provider] = {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        proxyKey: sharedProxyKey || config.proxyKey || map[config.provider]?.proxyKey || "",
        baseUrl: config.baseUrl,
        isLoggedIn: config.isLoggedIn,
        lastUsedAt: new Date().toISOString()
      };
    }
  }

  // Synchronize the single proxyKey across all saved provider profiles
  if (sharedProxyKey) {
    for (const key of Object.keys(map)) {
      if (map[key]) {
        map[key] = {
          ...map[key],
          proxyKey: sharedProxyKey
        };
      }
    }
  }

  return map;
}

/**
 * Updates LLMConfig with a new or updated provider profile.
 * Shares proxyKey across all saved provider entries.
 */
export function updateProviderProfile(
  currentConfig: LLMConfig,
  profile: SavedProviderConfig,
  makeActive: boolean = true
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  
  // Determine shared proxyKey: explicit profile proxyKey if set, or existing sharedProxyKey
  const sharedProxyKey = (profile.proxyKey !== undefined && profile.proxyKey !== "")
    ? profile.proxyKey 
    : (currentConfig.proxyKey || Object.values(savedMap).find(p => Boolean(p?.proxyKey))?.proxyKey || "");

  const updatedProfile: SavedProviderConfig = {
    ...profile,
    proxyKey: sharedProxyKey,
    isLoggedIn: true,
    lastUsedAt: new Date().toISOString()
  };

  savedMap[profile.provider] = updatedProfile;

  // Propagate single shared proxyKey to ALL stored provider profiles
  for (const pKey of Object.keys(savedMap)) {
    if (savedMap[pKey]) {
      savedMap[pKey] = {
        ...savedMap[pKey],
        proxyKey: sharedProxyKey
      };
    }
  }

  if (makeActive) {
    return {
      provider: profile.provider,
      model: profile.model,
      apiKey: profile.apiKey,
      proxyKey: sharedProxyKey,
      baseUrl: profile.baseUrl || "",
      isLoggedIn: true,
      savedProviders: savedMap
    };
  }

  return {
    ...currentConfig,
    proxyKey: sharedProxyKey,
    savedProviders: savedMap
  };
}

/**
 * Switch active provider to a saved or default profile while maintaining shared proxyKey
 */
export function switchActiveProvider(
  currentConfig: LLMConfig,
  targetProviderId: LLMProvider
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  const sharedProxyKey = currentConfig.proxyKey || Object.values(savedMap).find(p => Boolean(p?.proxyKey))?.proxyKey || "";
  const targetSaved = savedMap[targetProviderId];

  if (targetSaved) {
    const effectiveProxyKey = targetSaved.proxyKey || sharedProxyKey;
    const updatedMap = {
      ...savedMap,
      [targetProviderId]: {
        ...targetSaved,
        proxyKey: effectiveProxyKey,
        lastUsedAt: new Date().toISOString()
      }
    };

    return {
      provider: targetProviderId,
      model: targetSaved.model,
      apiKey: targetSaved.apiKey,
      proxyKey: effectiveProxyKey,
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
    proxyKey: sharedProxyKey,
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
        proxyKey: nextProfile.proxyKey,
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
        proxyKey: "",
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
