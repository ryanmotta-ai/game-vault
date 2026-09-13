# Phase 5A: Metadata Pipeline Architecture 📚

## Overview

The Game Vault Metadata Pipeline enriches raw technical game entities discovered in cloud storage into visually rich, structured catalog entries without ever compromising offline availability or technical identity.

> [!IMPORTANT]
> **Core Principle**: *"Metadata enriches the Game. It never substitutes its technical identity."*
> Even if all metadata providers are offline, or a game has zero remote matches, the game remains 100% playable and launchable offline.

---

## Architecture Diagram

```mermaid
flowchart TD
    Cloud[Cloud Discovery / Local ROMs] --> Ident[GameIdentificationService]
    Ident -->|GameIdentityQuery| JobMgr[MetadataJobManager]
    
    subgraph Pipeline [Metadata Scraping & Merge Pipeline]
        JobMgr --> Queue[MetadataJobsRepository (Priority Queue)]
        Queue --> CacheCheck{MetadataRequestCache}
        CacheCheck -->|Cache Hit| MatchRes[MetadataMatchResolver]
        CacheCheck -->|Cache Miss| Registry[MetadataProviderRegistry]
        
        Registry --> Hub[IntegrationManager (METADATA_SEARCH)]
        Hub --> SS[ScreenScraper v2]
        Hub --> IGDB[IGDB v4]
        Hub --> Steam[Steam Public Storefront]
        
        SS & IGDB & Steam --> Scorer[MetadataCandidateScorer]
        Scorer --> MatchRes
        
        MatchRes -->|Score >= 95 (Clear Winner)| AutoAccept[Apply Candidate]
        MatchRes -->|Ambiguous (Delta < 5) or Low Score| ReviewQueue[game_metadata_sources (REVIEW_REQUIRED)]
        
        AutoAccept --> Merge[MetadataMergeService]
        ReviewQueue --> UIModal[MetadataReviewModal (User Decision)]
        UIModal -->|User Confirms| Merge
        
        Merge --> CheckOverrides{user_override_flags Check}
        CheckOverrides -->|Preserve User Field| KeepUser[Retain Custom Value]
        CheckOverrides -->|Apply Remote Field| UpdateMeta[Update game_metadata & Mirror to games]
        
        UpdateMeta --> ArtJob[ArtworkCacheManager (Fetch & Cache Art)]
    end
    
    ArtJob --> DiskCache[(<cacheDir>/artwork/<gameId>/)]
```

---

## Database Schema (Migration 013)

The pipeline is backed by 4 dedicated SQLite tables introduced in migration `013_metadata_pipeline`:

### 1. `game_metadata`
Stores canonical enriched metadata for a game:
- `game_id` (TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE)
- `description` (TEXT)
- `release_date` (TEXT)
- `developer` (TEXT)
- `publisher` (TEXT)
- `genres` (TEXT, JSON array)
- `tags` (TEXT, JSON array)
- `critic_score` (REAL)
- `community_score` (REAL)
- `players` (TEXT)
- `esrb_rating` (TEXT)
- `user_override_flags` (TEXT, JSON array of field names edited by user)
- `enrichment_status` (`UNENRICHED`, `PARTIAL`, `COMPLETE`, `MANUAL`)
- `last_enriched_at` (TEXT)
- `created_at`, `updated_at` (TEXT)

### 2. `game_metadata_sources`
Tracks provider provenance, candidate history, and review queue items:
- `id` (TEXT PRIMARY KEY)
- `game_id` (TEXT REFERENCES games(id) ON DELETE CASCADE)
- `provider_id` (TEXT)
- `provider_game_id` (TEXT)
- `confidence` (`EXACT`, `HIGH`, `MEDIUM`, `LOW`, `AMBIGUOUS`)
- `matched_at` (TEXT)
- `status` (`MATCHED`, `REVIEW_REQUIRED`, `USER_CONFIRMED`, `USER_REJECTED`)
- `raw_payload` (TEXT, serialized JSON candidate data)
- `created_at`, `updated_at` (TEXT)
- **Constraint**: `UNIQUE(game_id, provider_id)`

### 3. `game_artwork`
Maintains individual artwork assets and primary flags:
- `id` (TEXT PRIMARY KEY)
- `game_id` (TEXT REFERENCES games(id) ON DELETE CASCADE)
- `type` (`COVER_FRONT`, `COVER_BACK`, `BANNER`, `BACKGROUND`, `SCREENSHOT`, `LOGO`)
- `provider` (TEXT)
- `remote_url` (TEXT)
- `local_path` (TEXT)
- `width` (INTEGER), `height` (INTEGER), `mime_type` (TEXT), `file_size_bytes` (INTEGER)
- `is_primary` (INTEGER DEFAULT 0)
- `is_user_custom` (INTEGER DEFAULT 0)
- `status` (`PENDING`, `DOWNLOADING`, `CACHED`, `FAILED`)
- `created_at`, `updated_at` (TEXT)

### 4. `metadata_jobs`
Drives the background processing queue:
- `id` (TEXT PRIMARY KEY)
- `game_id` (TEXT REFERENCES games(id) ON DELETE CASCADE)
- `priority` (`USER_REQUESTED` [0], `NORMAL` [1], `BACKGROUND` [2])
- `status` (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`)
- `retry_count` (INTEGER DEFAULT 0)
- `last_error` (TEXT)
- `created_at`, `updated_at`, `completed_at` (TEXT)

---

## User Override Preservation (`user_override_flags`)

A fundamental guarantee of Game Vault is that **manual user edits are inviolable**:

```typescript
// When a user manually modifies the title in the UI:
await metadataMergeService.setUserOverride(gameId, 'title', 'Custom Fan Translation');

// Any future background scrape or remote refresh will NEVER overwrite 'title':
const result = await metadataMergeService.applyCandidate(gameId, remoteCandidate);
// result.title remains 'Custom Fan Translation'
```

Protected fields include:
- `title`
- `releaseDate`
- `developer`
- `publisher`
- `description`
- `genres`
- `rating`

Users can clear individual override flags via Settings or UI modals to re-enable automated cloud synchronization.

---

## Provider Discovery & Decoupling

Metadata providers are decoupled and discovered dynamically at runtime via `IntegrationManager`:
- The pipeline queries `integrationManager.getConnectionsWithCapability('METADATA_SEARCH')`.
- Active connections (ScreenScraper, IGDB, Steam Storefront) are wrapped into `MetadataProvider` instances and queried concurrently.
- If no external integrations are active, the pipeline gracefully falls back to local heuristic extraction.

---

## Background Queue & Crash Recovery

The `MetadataJobManager` processes game enrichment asynchronously:
1. **Priority Scheduling**: `USER_REQUESTED` jobs jump immediately ahead of `NORMAL` and `BACKGROUND` batch queries.
2. **Crash Recovery**: On startup, `recoverStaleJobs()` detects any job left in `PROCESSING` status from a previous crash or sudden exit and resets it back to `QUEUED`.
3. **Throttling & Backoff**: Requests to external APIs respect provider rate limits and store 24-hour negative caches on not-found queries to prevent repeated hammering.
