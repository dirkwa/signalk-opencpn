import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import packageJson from './package.json' with { type: 'json' }

// Matches the Signal K Admin UI's own build (vite + @module-federation/vite).
// The Admin UI loads the panel from the server-injected
// <script type="module" src="/<plugin>/remoteEntry.js"> tag and expects the
// module to export `get` and `init`.
const federationName = packageJson.name.replace(/[-@/]/g, '_')

export default defineConfig({
  // The remote is served from /signalk-opencpn/, not the site root, so chunk
  // URLs must stay relative to remoteEntry.js.
  base: './',
  plugins: [
    react({
      // Classic runtime, matching the panel tsconfig's "jsx": "react".
      // The automatic runtime emits imports of react/jsx-runtime, which is NOT
      // in the `shared` scope below — the remote would then carry its own copy
      // of React's jsx runtime, giving the host page a second React instance
      // whose dispatcher is not the one the host set. `useState` then reads
      // null inside the host's render tree and the panel fails to mount at
      // runtime, with no build error.
      jsxRuntime: 'classic'
    }),
    federation({
      name: federationName,
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel': './src/configpanel/PluginConfigurationPanel.tsx'
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: packageJson.devDependencies.react
        }
      },
      // Nothing imports this remote's types (the panel is resolved by name at
      // runtime), and emitting @mf-types/ dominates build time.
      dts: false
    })
  ],
  // public/ is this plugin's OUTPUT directory (Signal K serves it), not a Vite
  // static-asset source. At the default, Vite would try to copy public/ into
  // itself and race the build.js artifacts written moments earlier.
  publicDir: false,
  build: {
    // Federation supplies the real entry; without this rolldown looks for an
    // index.html that does not exist.
    rollupOptions: { input: './src/configpanel/index.ts' },
    outDir: 'public',
    // build.js already wrote index.html and the icon into public/; emptying it
    // here would delete them.
    emptyOutDir: false,
    target: 'es2022',
    // MF remotes must not be inlined, and the host resolves chunks relative to
    // remoteEntry.js.
    cssCodeSplit: false
  }
})
