# Phase 5A: Artwork Pipeline Architecture & Security 🖼

## Overview

The Game Vault Artwork Pipeline provides local disk caching, SSRF-hardened network fetching, image validation, and custom user cover management. It guarantees high-speed, zero-latency image rendering in the UI without relying on live external CDNs.

---

## Directory Organization

Cached artwork is saved locally on disk under the user data directory:

```
<cacheDir>/artwork/<gameId>/
  ├── cover_front.png           # Scraped primary cover
  ├── cover_back.jpg            # Scraped back cover
  ├── banner.webp               # Horizontal storefront banner
  ├── background.jpg            # High-resolution hero wallpaper
  ├── logo.png                  # Transparent PNG/WebP title logo (alpha preserved)
  ├── screenshot_0.jpg          # In-game capture 0
  ├── screenshot_1.jpg          # In-game capture 1
  └── custom_cover_front.png    # User-uploaded manual cover (isUserCustom: true)
```

---

## Security & Defense-in-Depth

### 1. SSRF (Server-Side Request Forgery) Protection
When fetching artwork URLs from external metadata providers or candidate payloads, `ArtworkCacheManager.isUrlSafe()` enforces strict IP destination validation:

```typescript
public isUrlSafe(targetUrl: string): boolean {
  // Parses host and hostname
  // Blocks loopback: 127.0.0.1, localhost
  // Blocks RFC 1918 Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  // Blocks Link-local and AWS/GCP metadata services: 169.254.169.254
  // Blocks broadcast and internal IP patterns
}
```

Any attempt to fetch artwork targeting internal infrastructure or local services is rejected immediately before initiating an HTTP request.

### 2. Strict MIME Type Validation
Responses from remote endpoints are checked against valid image Content-Types:
- Supported MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`.
- HTML error pages, text payloads, or executable scripts masquerading as images are rejected and logged as errors.

### 3. File Size Boundaries
To protect user disk space and memory buffers, hard size boundaries are enforced:
- **Covers & Logos**: Maximum `15 MB` (`MAX_COVER_BYTES = 15 * 1024 * 1024`)
- **Backgrounds & Screenshots**: Maximum `25 MB` (`MAX_BACKGROUND_BYTES = 25 * 1024 * 1024`)

Transfers exceeding these boundaries are aborted mid-stream.

### 4. Alpha Channel Preservation for Logos
Wheel artwork and logos (`type === 'LOGO'`) are saved in formats supporting alpha channels (PNG or WebP). Game Vault never converts transparent logos into lossy JPEGs, ensuring clean overlays on UI backdrops.

---

## Primary Artwork & Conflict Resolution

Each artwork category (`COVER_FRONT`, `BANNER`, `BACKGROUND`, etc.) can have at most one primary asset for a given game in `game_artwork`.

When a new artwork record is inserted or updated with `isPrimary: true`:
- The `GameArtworkRepository.upsert()` automatically clears the `is_primary` flag on existing records of the same type for that game.
- Custom artwork (`is_user_custom = 1`) takes absolute precedence over provider-scraped artwork.

---

## Custom Artwork Uploads (`saveCustomArtwork`)

Users can assign their own covers directly from their operating system:
1. User clicks `[ Custom Cover ]` in `GameDetailsModal`.
2. Electron displays native file chooser dialog via `metadata:browseArtworkFile`.
3. The selected file is copied into `<cacheDir>/artwork/<gameId>/custom_cover_front.<ext>`.
4. An entry is upserted into `game_artwork` with `isPrimary = true` and `isUserCustom = true`.
5. The `games.local_cover_path` is updated immediately, triggering reactive UI re-rendering.

---

## Electron Custom Protocol (`local-artwork://`)

To bypass CSP restrictions on local file paths (`file:///`) while maintaining strict sandbox isolation, Electron registers a privileged custom protocol:

```typescript
// Registered in desktop/main.ts
protocol.registerFileProtocol('local-artwork', (request, callback) => {
  const parsedPath = decodeURIComponent(request.url.replace('local-artwork://', ''));
  // Path traversal check to ensure file is inside cacheDir
  callback({ path: parsedPath });
});
```

The UI references cached covers simply as:
`<img src="local-artwork://C:/Users/ryan/.../artwork/game_id/cover_front.png" />`

---

## Cache Management & Statistics

The Settings view provides live artwork cache analytics:
- Total image count
- Total disk usage (formatted in MB or GB)
- `[ Clear Artwork Cache ]` action to safely wipe disk contents while preserving game catalog records.
