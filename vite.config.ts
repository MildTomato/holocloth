import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** the Visual Engine commit this build draws with: cached artwork is only reused for the same one */
function engineRev() {
  try {
    return execSync('git rev-parse --short HEAD:visual-engine-generator', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __ENGINE_REV__: JSON.stringify(engineRev()),
  },
  server: {
    port: Number(process.env.PORT) || 5199,
  },
});
