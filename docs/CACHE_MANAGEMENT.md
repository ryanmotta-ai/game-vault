# Game Vault — Smart Cache Management & Safe Eviction (Phase 3C) 💾

## 1. Overview & Storage Philosophy

Game Vault provides a smart, self-maintaining cache architecture. The user never has to organize game files, move directories, or guess where their hard drive space went.

Key principles:
1. **Zero Data Loss on Eviction:** Deleting local files must never wipe a user's cloud inventory, custom artwork, playtime statistics, tags, or personal notes.
2. **Deterministic Cache Boundaries:** Temporary downloads, in-flight extraction sandboxes, installed games, and cached artworks reside in strictly isolated subtrees.
3. **Automated LRU Prioritization with User Overrides:** Games that haven't been played in months can be automatically or manually reclaimed to free space, but **pinned games** are permanently protected.

---

## 2. 4-Tier Cache Directory Hierarchy

All cached content is stored inside `<cacheRoot>/` (configurable in settings via `cache_dir`, defaulting to OS app data / cache):

```text
<cacheRoot>/
├── downloads/
│   └── partial/             # [Tier 1: PARTIAL] Active / paused HTTP range downloads (.part)
├── prepare/                 # [Tier 2: TEMP] Isolated extraction & validation sandboxes (<jobId>/)
├── games/                   # [Tier 3: GAME] Ready-to-play extracted games & ROMs (<gameId>/)
│   ├── <gameId_1>/
│   │   ├── manifest.json
│   │   └── ...
│   └── <gameId_2>/
│       ├── manifest.json
│       └── ...
└── artwork/                 # [Tier 4: ARTWORK] Cached game box art, covers, banners, icons
```

### Storage Categories Matrix
| Category | Directory Path | Purpose | Eviction Policy |
| :--- | :--- | :--- | :--- |
| `PARTIAL` | `<cache>/downloads/partial/` | In-progress or paused downloads (`<id>.part`) | Can be cleared on cancel or if corrupted |
| `TEMP` | `<cache>/prepare/` | Ephemeral unzipping sandboxes (`<jobId>/`) | Pruned automatically on startup or after job completion |
| `GAME` | `<cache>/games/` | Ready-to-play games and ROMs (`<gameId>/`) | Subject to LRU eviction; protected by `pinned = 1` |
| `ARTWORK` | `<cache>/artwork/` | Thumbnails and box covers | Persistent; pruned only when orphaned |

---

## 3. Storage Usage Tracking & Cache Limits

The `CacheManager` service aggregates storage metrics and enforces user-defined limits:

### Metrics API (`getStorageBreakdown`)
Computes real-time byte sizes across all four tiers:
```typescript
interface StorageBreakdown {
  totalBytes: number;
  partialBytes: number;
  tempBytes: number;
  gamesBytes: number;
  artworkBytes: number;
  availableDiskBytes: number;
  maxCacheBytes: number;
}
```

### Dynamic Limit Enforcement
- Users configure `cache_max_bytes` in settings (e.g. 50 GB, 100 GB, 500 GB, or unlimited).
- When a new download or preparation would exceed `cache_max_bytes`:
  - `CacheManager` calculates needed reclaim space.
  - Generates an LRU eviction plan prioritizing the least recently accessed unpinned games.
  - Recommends candidates in UI or automatically frees space if auto-eviction is enabled.

---

## 4. LRU Eviction Engine & Game Pinning

### Candidate Selection Algorithm
When local storage needs to be reclaimed:
1. Query games where `state = 'READY'` and `installed_path IS NOT NULL`.
2. **Exclude Pinned Games:** Filter out any game with `pinned = 1`.
3. **Sort Order:** Sort remaining candidates by `last_accessed_at ASC NULLS FIRST`, then by `size_bytes DESC`.
4. **Safety Buffer:** Select sufficient candidates to satisfy the required free space plus the safety margin (`512 MB`).

### Pinned Games (`pinned = 1`)
- Users can click the **Pin** icon on any game card or in the Storage Manager.
- A pinned game is **guaranteed immunity** from automated LRU eviction.
- Even when disk space is critically low, pinned games will never be purged unless the user explicitly unpins them or chooses to manually remove their local copy.

---

## 5. Non-Destructive "Remove Local Copy"

A core feature of Game Vault is non-destructive local removal.

### What Happens on `removeLocalCopy(gameId)`:
1. **Local Files Deleted:**
   - The game directory `<cacheDir>/games/<gameId>/` is deleted recursively.
   - Any associated `.part` files in `<cacheDir>/downloads/partial/` are deleted.
2. **Local Manifest Cleared:**
   - The entry in `game_manifests` is removed.
3. **Database State Updated:**
   - `games.state` transitions from `READY` back to `CLOUD`.
   - `games.installed_path` is set to `null`.
   - `game_files.status` transitions from `CACHED_LOCAL` back to `REMOTE`.
   - `game_files.local_path` is set to `null`.
4. **Preserved Forever:**
   - `games.title`, `games.platform`, `games.description`
   - `games.play_time_seconds` and `games.last_played_at`
   - `games.user_rating` and `games.notes`
   - `games.remote_id` and cloud drive association
   - Box art and artwork cache
5. **Result:**
   - The game remains in the library with all its history intact.
   - The action button changes back from `[ PLAY ]` to `[ DOWNLOAD ]`.

---

## 6. Defensive Filesystem Safety (`safeDelete`)

Filesystem deletions must be guarded against software bugs or malicious path injections:

```typescript
export async function safeDeleteGameDirectory(cacheDir: string, gameId: string): Promise<void> {
  // 1. Validate gameId syntax
  if (!gameId || typeof gameId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(gameId)) {
    throw new ValidationError(`Invalid gameId for deletion: "${gameId}"`);
  }

  // 2. Resolve target path
  const targetPath = path.resolve(cacheDir, 'games', gameId);
  const gamesRoot = path.resolve(cacheDir, 'games') + path.sep;

  // 3. Boundary check: must be strictly inside <cacheDir>/games/
  if (!targetPath.startsWith(gamesRoot)) {
    throw new PathTraversalError(`Attempted deletion outside games directory: ${targetPath}`);
  }

  // 4. Root safety check: never delete filesystem root or cache root
  if (targetPath === path.resolve(cacheDir) || targetPath === path.parse(targetPath).root) {
    throw new SafetyViolationError(`Attempted deletion of protected root: ${targetPath}`);
  }

  // 5. Delete atomically & cleanly
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}
```
