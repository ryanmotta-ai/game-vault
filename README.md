# GAME VAULT 🎮

> Desktop Game Launcher transforming user personal cloud storage into a unified, console-like game library.

Game Vault allows users to connect their personal cloud storage (starting with Google Drive, followed by OneDrive, Dropbox, NAS, and local directories) and view their collection in a sleek, Steam/console-like interface. Games transition smoothly between remote cloud availability, on-demand local caching, and instant offline play.

The application is built completely **without any dependency on `rclone`**, relying on native modular storage provider abstractions and secure Node/Electron APIs.

---

## ⚡ Tech Stack

- **Shell & Desktop**: [Electron 34](https://www.electronjs.org/) (Strict Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP enforced)
- **UI & Components**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler & Tooling**: [Vite 6](https://vitejs.dev/) (Renderer) + [esbuild](https://esbuild.github.io/) (Main & Preload)
- **Local Database**: [SQLite](https://www.sqlite.org/) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (WAL mode + Foreign Keys enabled + Versioned Migrations)
- **Authentication & Security**: Native Google OAuth 2.0 with **PKCE (S256)** + Local Loopback Server ([RFC 8252](https://tools.ietf.org/html/rfc8252)) + Windows DPAPI via Electron `safeStorage`
- **Design System**: Steam / Modern Console Dark UI (`#0a0d14` palette, responsive card grid, status badges)

---

## 📁 Directory Architecture

The codebase enforces strict separation of concerns across dedicated domain modules:

```
src/
├── desktop/         # Electron Main process, window lifecycle, preload, secure IPC & security policies
├── ui/              # React Renderer application (Header, Sidebar, Views, Components & Styles)
├── core/            # Domain models, structured logger, typed errors, config manager, CredentialStore (DPAPI)
├── storage/         # StorageManager (multi-account) & CacheManager (disk usage, quota aggregation)
├── providers/       # StorageProvider interface, ProviderFactory, and GoogleDriveProvider (OAuth 2.0 PKCE)
├── database/        # SQLite connection, MigrationRunner, versioned DDL, and typed repositories
├── downloads/       # DownloadManager lifecycle contract and queue data structures
├── launchers/       # Native PC game execution service contracts
├── emulators/       # Emulator mapping and runner service contracts
└── metadata/        # Metadata enrichment and scraper service contracts
```

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v20+ (tested on Node v24)
- npm v10+

### Installation & Setup
```bash
# Clone or navigate to the project directory
cd game-vault

# Install dependencies (automatically runs postinstall rebuild for Electron SQLite)
npm install

# Setup Google Cloud OAuth Credentials (see docs/GOOGLE_DRIVE_SETUP.md)
cp .env.example .env
# Edit .env and paste your GAMEVAULT_GOOGLE_CLIENT_ID and GAMEVAULT_GOOGLE_CLIENT_SECRET
```

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts Vite dev server + compiles desktop & launches Electron |
| `npm run build` | Builds desktop (`scripts/build-desktop.mjs`) and renderer (`vite build`) |
| `npm run start` | Runs the compiled production application with Electron |
| `npm run typecheck` | Runs strict TypeScript verification across all files (`tsc --noEmit`) |
| `npm run lint` | Runs ESLint 9 Flat Config static analysis |
| `npm run test:db` | Runs comprehensive migration, security, multi-account, and repository tests |

---

## 🛡 Security & Authentication Highlights

- **Zero Hardcoded Credentials**: No tokens, client IDs, or secrets committed in code.
- **Windows DPAPI Token Encryption**: OAuth access tokens and refresh tokens are encrypted at rest using OS-level DPAPI (`safeStorage`) with AES-256-GCM fallback. Tokens are never stored in SQLite and are never sent to the renderer process.
- **Strict Least-Privilege Scopes**: Only `drive.readonly` and basic user info (`userinfo.profile`, `userinfo.email`) are requested. The app can never delete or modify files in your cloud storage.
- **Native RFC 8252 Loopback Flow**: Uses PKCE (Proof Key for Code Exchange) with SHA-256 challenges on an ephemeral local loopback server (`127.0.0.1:<port>/oauth2callback`) opened directly in the system's default browser.
- **Multi-Account Storage Support**: Link multiple independent Google accounts simultaneously with individual disconnect/reconnect actions and unified storage quota aggregation.
- **Context Isolation & CSP**: Renderer never has direct Node.js access; communication occurs exclusively via typed IPC channels defined in `IPC_CHANNELS`.
- **Navigation Protection**: Intercepts external links to open safely in the user's OS browser via `shell.openExternal`.

---

## 📄 License

Proprietary — Built for Game Vault.
