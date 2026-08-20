import { LLMConfig, LLMProvider, SavedProviderConfig, SavedProvidersMap } from "../types";
import { PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID, getDefaultLLMConfig } from "../config/llmProviders";

/**
 * Sanitizes LLMConfig against current PROVIDER_OPTIONS in code.
 * Strips out any deprecated or removed model names and falls back to provider defaultModel.
 */
export function sanitizeLlmConfig(config: LLMConfig): LLMConfig {
  if (!config) return getDefaultLLMConfig();

  const provider = config.provider || DEFAULT_PROVIDER_ID;
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === provider);

  let sanitizedModel = config.model;
  if (providerMeta && provider !== "custom" && provider !== "auto") {
    const isModelValid = 
      Boolean(sanitizedModel) && (
        providerMeta.models.includes(sanitizedModel) ||
        Boolean(providerMeta.visionModels?.includes(sanitizedModel)) ||
        Boolean(providerMeta.tts_models?.includes(sanitizedModel))
      );
    
    if (!isModelValid) {
      sanitizedModel = providerMeta.defaultModel;
    }
  }

  const rawSavedMap = config.savedProviders || {};
  const sanitizedSavedMap: SavedProvidersMap = {};

  for (const [pKey, pVal] of Object.entries(rawSavedMap)) {
    if (!pVal) continue;
    const pMeta = PROVIDER_OPTIONS.find(p => p.id === pKey);
    let pModel = pVal.model;

    if (pMeta && pKey !== "custom" && pKey !== "auto") {
      const isPModelValid = 
        Boolean(pModel) && (
          pMeta.models.includes(pModel) ||
          Boolean(pMeta.visionModels?.includes(pModel)) ||
          Boolean(pMeta.tts_models?.includes(pModel))
        );

      if (!isPModelValid) {
        pModel = pMeta.defaultModel;
      }
    }

    sanitizedSavedMap[pKey] = {
      ...pVal,
      model: pModel
    };
  }

  return {
    ...config,
    provider,
    model: sanitizedModel,
    savedProviders: sanitizedSavedMap
  };
}

/**
 * Gets saved providers map from LLMConfig with safety fallbacks
 */
export function getSavedProvidersMap(config: LLMConfig): SavedProvidersMap {
  const sanitizedConfig = sanitizeLlmConfig(config);
  const map: SavedProvidersMap = sanitizedConfig.savedProviders ? { ...sanitizedConfig.savedProviders } : {};
  
  // Ensure current active provider is present in map if logged in
  if (sanitizedConfig.provider && sanitizedConfig.isLoggedIn) {
    if (
      !map[sanitizedConfig.provider] || 
      sanitizedConfig.apiKey !== map[sanitizedConfig.provider].apiKey || 
      sanitizedConfig.model !== map[sanitizedConfig.provider].model
    ) {
      map[sanitizedConfig.provider] = {
        provider: sanitizedConfig.provider,
        model: sanitizedConfig.model,
        apiKey: sanitizedConfig.apiKey,
        baseUrl: sanitizedConfig.baseUrl,
        isLoggedIn: sanitizedConfig.isLoggedIn,
        lastUsedAt: new Date().toISOString()
      };
    }
  }

  return map;
}

/**
 * Updates LLMConfig with a new or updated provider profile.
 */
export function updateProviderProfile(
  currentConfig: LLMConfig,
  profile: SavedProviderConfig,
  makeActive: boolean = true
): LLMConfig {
  const sanitizedCurrent = sanitizeLlmConfig(currentConfig);
  const savedMap = getSavedProvidersMap(sanitizedCurrent);
  
  // Validate profile model against PROVIDER_OPTIONS
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === profile.provider);
  let validatedModel = profile.model;
  if (providerMeta && profile.provider !== "custom" && profile.provider !== "auto") {
    const isValid = 
      Boolean(validatedModel) && (
        providerMeta.models.includes(validatedModel) ||
        Boolean(providerMeta.visionModels?.includes(validatedModel)) ||
        Boolean(providerMeta.tts_models?.includes(validatedModel))
      );
    if (!isValid) {
      validatedModel = providerMeta.defaultModel;
    }
  }

  const updatedProfile: SavedProviderConfig = {
    ...profile,
    model: validatedModel,
    isLoggedIn: true,
    lastUsedAt: new Date().toISOString()
  };

  savedMap[profile.provider] = updatedProfile;

  if (makeActive) {
    return sanitizeLlmConfig({
      provider: profile.provider,
      model: validatedModel,
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl || "",
      isLoggedIn: true,
      savedProviders: savedMap
    });
  }

  return sanitizeLlmConfig({
    ...sanitizedCurrent,
    savedProviders: savedMap
  });
}

/**
 * Switch active provider to a saved or default profile
 */
export function switchActiveProvider(
  currentConfig: LLMConfig,
  targetProviderId: LLMProvider
): LLMConfig {
  const sanitizedCurrent = sanitizeLlmConfig(currentConfig);
  const savedMap = getSavedProvidersMap(sanitizedCurrent);
  const targetSaved = savedMap[targetProviderId];
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === targetProviderId) || PROVIDER_OPTIONS[0];

  if (targetSaved) {
    const isModelValid = 
      targetProviderId === "custom" || 
      targetProviderId === "auto" || 
      (Boolean(targetSaved.model) && (
        providerMeta.models.includes(targetSaved.model) ||
        Boolean(providerMeta.visionModels?.includes(targetSaved.model)) ||
        Boolean(providerMeta.tts_models?.includes(targetSaved.model))
      ));

    const effectiveModel = isModelValid ? targetSaved.model : providerMeta.defaultModel;

    const updatedMap = {
      ...savedMap,
      [targetProviderId]: {
        ...targetSaved,
        model: effectiveModel,
        lastUsedAt: new Date().toISOString()
      }
    };

    return sanitizeLlmConfig({
      provider: targetProviderId,
      model: effectiveModel,
      apiKey: targetSaved.apiKey || "",
      baseUrl: targetSaved.baseUrl || "",
      useProxy: targetSaved.useProxy !== undefined ? targetSaved.useProxy : true,
      isLoggedIn: true,
      savedProviders: updatedMap
    });
  }

  // Fallback to provider defaults (proxy worker)
  return sanitizeLlmConfig({
    provider: targetProviderId,
    model: providerMeta.defaultModel,
    apiKey: "",
    baseUrl: providerMeta.defaultBaseUrl || "",
    useProxy: true,
    isLoggedIn: true,
    savedProviders: savedMap
  });
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
  const p = provider.toLowerCase();
  if (p === "gemini" || p === "google") return "Google Gemini";
  if (p === "openrouter") return "OpenRouter";
  if (p === "groq") return "Groq";
  if (p === "cloudflare") return "Cloudflare AI";
  if (p === "9flare") return "9Flare";
  if (p === "ollama") return "Ollama";
  if (p === "auto") return "Auto Mode";
  if (p === "custom") return "Custom Endpoint";
  const meta = PROVIDER_OPTIONS.find(opt => opt.id === provider);
  if (meta) return meta.name.replace(/\s*\(Default\)/i, "").trim();
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Returns consistent styling badges for providers
 */
export function getProviderBadgeStyle(provider?: string): { bg: string; text: string; border: string; label: string } {
  const p = (provider || "").toLowerCase();
  const label = getProviderDisplayName(provider);

  switch (p) {
    case "openrouter":
      return { bg: "bg-indigo-50", text: "text-indigo-800 font-semibold", border: "border-indigo-200/80", label };
    case "groq":
      return { bg: "bg-amber-50", text: "text-amber-900 font-bold", border: "border-amber-200/90", label };
    case "gemini":
    case "google":
      return { bg: "bg-sky-50", text: "text-sky-900 font-bold", border: "border-sky-200/90", label };
    case "cloudflare":
      return { bg: "bg-orange-50", text: "text-orange-900 font-semibold", border: "border-orange-200/80", label };
    case "9flare":
      return { bg: "bg-emerald-50", text: "text-emerald-900 font-bold", border: "border-emerald-200/90", label };
    case "ollama":
      return { bg: "bg-teal-50", text: "text-teal-900 font-semibold", border: "border-teal-200/80", label };
    case "auto":
      return { bg: "bg-purple-50", text: "text-purple-900 font-bold", border: "border-purple-200/90", label };
    default:
      return { bg: "bg-stone-100", text: "text-stone-700 font-semibold", border: "border-stone-200", label };
  }
}

/**
 * Clean & format raw model strings into clean human-readable model names
 */
export function formatModelDisplayName(modelName?: string): string {
  if (!modelName) return "AI Model";
  const raw = modelName.trim();

  if (raw === "auto") return "Auto Model";
  if (raw === "custom") return "Custom Model";

  // Strip prefix paths
  let cleaned = raw
    .replace(/^google\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^pro\//i, "")
    .replace(/^qwen\//i, "")
    .replace(/^@cf\/[^\/]+\//i, "")
    .replace(/^@cf\//i, "");

  const lower = cleaned.toLowerCase();
  if (lower.includes("gemini-3.6-flash")) return "Gemini 3.6 Flash";
  if (lower.includes("gemini-3.5-flash-lite")) return "Gemini 3.5 Flash Lite";
  if (lower.includes("gemini-3.5-flash")) return "Gemini 3.5 Flash";
  if (lower.includes("gemini-3.1-flash-lite")) return "Gemini 3.1 Flash Lite";
  if (lower.includes("gpt-oss-120b")) return "GPT OSS 120B";
  if (lower.includes("gpt-oss-20b")) return "GPT OSS 20B";
  if (lower.includes("gpt-oss-safeguard-20b")) return "GPT OSS Safeguard 20B";
  if (lower.includes("qwen3.6-27b")) return "Qwen 3.6 27B";
  if (lower.includes("claude-haiku-4-5")) return "Claude Haiku 4.5";
  if (lower.includes("gpt-5.6-luna")) return "GPT 5.6 Luna";
  if (lower.includes("gemma-sea-lion-v4-27b-it")) return "Sea Lion v4 27B";
  if (lower.includes("gemma4:31b")) return "Gemma 4 (31B)";
  if (lower.includes("gpt-oss:20b")) return "GPT OSS 20B";
  if (lower.includes("nemotron-3-nano:30b-cloud")) return "Nemotron 3 Nano (30B)";

  return cleaned
    .split(/[-_:]+/)
    .map((word) => {
      if (!word) return "";
      const wLower = word.toLowerCase();
      if (wLower === "gpt") return "GPT";
      if (wLower === "oss") return "OSS";
      if (wLower === "it") return "IT";
      if (wLower === "ai") return "AI";
      if (wLower === "llm") return "LLM";
      if (/^\d+[a-z]$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Formats AI response time in seconds with appropriate icon and badge style
 */
export function formatResponseTime(ms?: number): { text: string; icon: string; style: string; badgeText: string } {
  if (ms === undefined || ms === null) {
    return { text: "--", icon: "⏱️", style: "text-stone-400 bg-stone-50 border-stone-200", badgeText: "N/A" };
  }
  const seconds = (ms / 1000).toFixed(2);
  if (ms < 2000) {
    return {
      text: `${seconds}s`,
      icon: "⚡",
      style: "text-emerald-700 bg-emerald-50/90 border-emerald-200/90 font-bold",
      badgeText: "Fast"
    };
  }
  if (ms < 5000) {
    return {
      text: `${seconds}s`,
      icon: "⚡",
      style: "text-stone-700 bg-stone-100/90 border-stone-200/80 font-medium",
      badgeText: "Normal"
    };
  }
  return {
    text: `${seconds}s`,
    icon: "⏱️",
    style: "text-amber-800 bg-amber-50/90 border-amber-200/80 font-medium",
    badgeText: "Steady"
  };
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
