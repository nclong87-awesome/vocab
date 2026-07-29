import packageJson from "../../package.json";

/**
 * Dynamically generated app version sourced from package.json
 */
export const APP_VERSION: string = (import.meta as any).env?.VITE_APP_VERSION || packageJson.version || "1.0.0";
export const APP_NAME: string = packageJson.name || "Vocabulary Learner";
