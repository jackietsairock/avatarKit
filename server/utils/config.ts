export interface AppConfig {
  removeBgApiKey: string;
  removeBgApiUrl: string;
  maxFiles: number;
  removeBgTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  const {
    REMOVE_BG_API_KEY = '',
    REMOVE_BG_API_URL = 'https://api.remove.bg/v1.0/removebg',
    REMOVE_BG_MAX_FILES = '50',
    REMOVE_BG_TIMEOUT_MS = '45000'
  } = process.env;

  return {
    removeBgApiKey: REMOVE_BG_API_KEY,
    removeBgApiUrl: REMOVE_BG_API_URL,
    maxFiles: Number.parseInt(REMOVE_BG_MAX_FILES, 10) || 50,
    removeBgTimeoutMs: Number.parseInt(REMOVE_BG_TIMEOUT_MS, 10) || 45000
  };
}
