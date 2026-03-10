import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
   VitePWA({
  registerType: "autoUpdate",
  injectRegister: "auto",

  workbox: {
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true
  },

  manifest: {
    name: "Don't Forget It",
    short_name: "DFI",
    description: "O primeiro sistema de memória que se adapta ao seu cérebro em tempo real.",
    start_url: ".",
    display: "standalone",
    theme_color: "#121212",
    background_color: "#121212",
    icons: [
      {
        src: "/pwa-192x192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/pwa-512x512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  }
})
  ],

  server: {
    host: true
  },

  preview: {
    host: true,

    // 🔥 ISSO resolve o blocked request
    allowedHosts: [
      "projectional-complainingly-altha.ngrok-free.dev"
    ]
  }
})