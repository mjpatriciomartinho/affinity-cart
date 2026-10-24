import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into the WordPress plugin as one IIFE + one stylesheet,
// enqueued by includes/class-admin.php.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "../../plugins/woocommerce/affinity-cart/assets/admin",
    emptyOutDir: true,
    lib: { entry: "src/main.tsx", formats: ["iife"], name: "AffinityCartAdminApp", fileName: () => "admin.js", cssFileName: "admin" },
  },
});
