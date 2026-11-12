import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // lets other devices on your network open the app
    allowedHosts: true,  // lets tunnels like ngrok work
    proxy: { "/api": "http://localhost:3001" }, // API calls go to the Express server
  },
});
