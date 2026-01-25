import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        // Enable polling for WSL (Windows filesystem doesn't support inotify)
        watch: {
            usePolling: true,
            interval: 1000,
        },
    },
})
