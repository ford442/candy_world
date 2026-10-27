/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    /** Realtime protocol override (`1.0.0` = JSON) for older Realtime servers. */
    readonly VITE_SUPABASE_REALTIME_VSN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
