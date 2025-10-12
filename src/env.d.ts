/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_MAX_FILES?: string;
  readonly API_MAX_FILES?: string;
  readonly API_PORT?: string;
  readonly API_BODY_LIMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __AVATAR_MAX_FILES__: number;
