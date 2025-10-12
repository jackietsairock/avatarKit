/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly REMOVE_BG_API_KEY?: string;
  readonly REMOVE_BG_API_URL?: string;
  readonly PUBLIC_MAX_FILES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __REMOVE_BG_MAX_FILES__: number;
