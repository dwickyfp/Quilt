import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],

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
