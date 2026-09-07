import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      input: {
              main: resolve(__dirname, 'index.html'),
              gallery: resolve(__dirname, 'gallery.html'),
              trial: resolve(__dirname, 'trial.html'),
              personal_training: resolve(__dirname, 'personal-training.html'),
              privacy: resolve(__dirname, 'privacy.html'),
              schedule: resolve(__dirname, 'schedule.html'),
            },
    },
  },
});
