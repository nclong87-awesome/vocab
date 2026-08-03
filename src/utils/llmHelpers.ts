import { LLMConfig, LLMProvider, SavedProviderConfig, SavedProvidersMap } from "../types";
import { PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID } from "../config/llmProviders";

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
      model: targetSaved.model || PROVIDER_OPTIONS.find(p => p.id === targetProviderId)?.defaultModel || "openai/gpt-oss-120b",
      apiKey: targetSaved.apiKey || "",
      proxyKey: effectiveProxyKey,
      baseUrl: targetSaved.baseUrl || "",
      useProxy: targetSaved.useProxy !== undefined ? targetSaved.useProxy : true,
      isLoggedIn: true,
      savedProviders: updatedMap
    };
  }

  // Fallback to provider defaults (proxy worker)
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === targetProviderId) || PROVIDER_OPTIONS[0];

  return {
    provider: targetProviderId,
    model: providerMeta.defaultModel,
    apiKey: "",
    proxyKey: sharedProxyKey,
    baseUrl: providerMeta.defaultBaseUrl || "",
    useProxy: true,
    isLoggedIn: true,
    savedProviders: savedMap
  };
}

/**
 * Removes custom/direct API key configuration for a provider, falling back to proxy worker.
 * For 'custom' provider, completely deletes the custom profile.
 */
export function removeProviderProfile(
  currentConfig: LLMConfig,
  targetProviderId: LLMProvider
): LLMConfig {
  const savedMap = getSavedProvidersMap(currentConfig);
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === targetProviderId);

  if (targetProviderId === "custom") {
    delete savedMap["custom"];
    if (currentConfig.provider === "custom") {
      const defaultMeta = PROVIDER_OPTIONS.find(p => p.id === DEFAULT_PROVIDER_ID) || PROVIDER_OPTIONS[0];
      return {
        provider: defaultMeta.id,
        model: defaultMeta.defaultModel,
        apiKey: "",
        proxyKey: currentConfig.proxyKey || "",
        baseUrl: defaultMeta.defaultBaseUrl || "",
        useProxy: true,
        isLoggedIn: true,
        savedProviders: savedMap
      };
    }
    return {
      ...currentConfig,
      savedProviders: savedMap
    };
  }

  // Non-custom provider: remove direct API key and fall back to default proxy worker
  if (savedMap[targetProviderId]) {
    savedMap[targetProviderId] = {
      ...savedMap[targetProviderId],
      apiKey: "",
      useProxy: true,
      baseUrl: providerMeta?.defaultBaseUrl || "",
      isLoggedIn: true,
      lastUsedAt: new Date().toISOString()
    };
  }

  if (currentConfig.provider === targetProviderId) {
    return {
      ...currentConfig,
      apiKey: "",
      useProxy: true,
      baseUrl: providerMeta?.defaultBaseUrl || "",
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
 * Friendly display name for LLM providers
 */
export function getProviderDisplayName(provider?: string): string {
  if (!provider) return "Selected AI";
  const meta = PROVIDER_OPTIONS.find(p => p.id === provider);
  if (meta) return meta.name;
  if (provider === "gemini") return "Google Gemini";
  if (provider === "openai") return "OpenAI";
  if (provider === "groq") return "Groq";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "chatjimmy") return "ChatJimmy AI";
  if (provider === "ollama") return "Ollama";
  if (provider === "9flare") return "9Flare";
  if (provider === "custom") return "Custom Endpoint";
  return provider;
}

/**
 * Resizes a base64 image Data URL on the client side using HTML5 Canvas
 * to limit maximum dimension (default 1600px) and compress JPEG quality (0.85).
 */
export function resizeImageDataUrl(dataUrl: string, maxDimension = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !dataUrl || !dataUrl.startsWith("data:image")) {
      return resolve(dataUrl);
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width <= maxDimension && height <= maxDimension && dataUrl.length < 500000) {
        // Already within acceptable bounds
        return resolve(dataUrl);
      }

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        return resolve(dataUrl);
      }

      ctx.drawImage(img, 0, 0, width, height);

      try {
        const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedDataUrl);
      } catch (err) {
        console.warn("Client-side image resize failed, using original:", err);
        resolve(dataUrl);
      }
    };

    img.onerror = () => {
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
}
