/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_HOPFAST_API_BASE_URL?: string;
  readonly VITE_HOPFAST_QUOTE_PROXY_URL?: string;
  readonly VITE_HOPFAST_INTENT_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
