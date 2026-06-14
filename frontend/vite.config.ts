import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tauriConf from '../apps/desktop/tauri.conf.json';

// Single source of truth for the app version: the Tauri config. Read at build
// time and exposed to the frontend as __APP_VERSION__ so the status bar can
// show it without a runtime Tauri call (works in the browser too).
const APP_VERSION = (tauriConf as { version?: string }).version ?? '0.0.0';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],

    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },

    // Tauri injects env vars; tell Vite to expose them.
    envPrefix: ['VITE_', 'TAURI_ENV_*'],

    // Tauri owns the console output for prettier dev UX.
    clearScreen: false,

    server: {
        port: 5173,
        strictPort: true,
        watch: {
            ignored: ['**/apps/desktop/**', '**/target/**'],
        },
    },

    build: {
        target: 'es2022',
        // Smaller bundles; Tauri ships the webview which already supports modern JS.
        minify: 'esbuild',
        sourcemap: false,
    },

    // Match the build target during dependency pre-bundling. The default
    // includes safari14, whose destructuring bug makes esbuild try (and fail)
    // to lower `const {x} = module.exports` in deps like debug@4.4.x.
    optimizeDeps: {
        esbuildOptions: {
            target: 'es2022',
        },
    },
});
