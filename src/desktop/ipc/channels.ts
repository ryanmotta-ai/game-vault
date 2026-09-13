export const IPC_CHANNELS = {
  // Games
  GAMES_GET_ALL: 'games:getAll',
  GAMES_GET_BY_ID: 'games:getById',
  GAMES_GET_BY_STATE: 'games:getByState',
  GAMES_UPDATE_STATE: 'games:updateState',

  // Storage & Accounts
  STORAGE_GET_ACCOUNTS: 'storage:getAccounts',
  STORAGE_CONNECT_ACCOUNT: 'storage:connectAccount',
  STORAGE_DISCONNECT_ACCOUNT: 'storage:disconnectAccount',
  STORAGE_RECONNECT_ACCOUNT: 'storage:reconnectAccount',
  STORAGE_GET_QUOTA_SUMMARY: 'storage:getQuotaSummary',
  STORAGE_CLEAR_CACHE: 'storage:clearCache',
  STORAGE_LIST_FILES: 'storage:listFiles',

  // Cloud Inventory & Sync
  SYNC_SCAN_ACCOUNT: 'sync:scanAccount',
  SYNC_SCAN_ALL: 'sync:scanAll',
  SYNC_CANCEL: 'sync:cancel',
  SYNC_GET_STATUS: 'sync:getStatus',
  SYNC_GET_SUMMARY: 'sync:getSummary',
  SYNC_PROGRESS_EVENT: 'sync:progressEvent',

  // Downloads
  DOWNLOADS_GET_ALL: 'downloads:getAll',
  DOWNLOADS_QUEUE: 'downloads:queue',
  DOWNLOADS_CANCEL: 'downloads:cancel',

  // Settings
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',

<<<<<<< Updated upstream
=======
  // Integrations & Connected Services Hub
  INTEGRATIONS_LIST: 'integrations:list',
  INTEGRATIONS_GET: 'integrations:get',
  INTEGRATIONS_GET_CONNECTIONS: 'integrations:getConnections',
  INTEGRATIONS_CONNECT: 'integrations:connect',
  INTEGRATIONS_DISCONNECT: 'integrations:disconnect',
  INTEGRATIONS_REMOVE_CONNECTION: 'integrations:removeConnection',
  INTEGRATIONS_TEST: 'integrations:test',
  INTEGRATIONS_GET_HEALTH: 'integrations:getHealth',

  // Metadata & Artwork Scraping (Phase 5A)
  METADATA_SCRAPE_GAME: 'metadata:scrapeGame',
  METADATA_SCRAPE_ALL: 'metadata:scrapeAll',
  METADATA_SEARCH: 'metadata:search',
  METADATA_APPLY_CANDIDATE: 'metadata:applyCandidate',
  METADATA_GET_DETAILS: 'metadata:getDetails',
  METADATA_SET_USER_OVERRIDE: 'metadata:setUserOverride',
  METADATA_REMOVE_USER_OVERRIDE: 'metadata:removeUserOverride',
  METADATA_GET_REVIEW_QUEUE: 'metadata:getReviewQueue',
  METADATA_RESOLVE_REVIEW: 'metadata:resolveReview',
  METADATA_SAVE_CUSTOM_ARTWORK: 'metadata:saveCustomArtwork',
  METADATA_BROWSE_ARTWORK_FILE: 'metadata:browseArtworkFile',
  METADATA_ENQUEUE_JOB: 'metadata:enqueueJob',
  METADATA_GET_JOB_STATUS: 'metadata:getJobStatus',
  METADATA_GET_CACHE_STATS: 'metadata:getCacheStats',
  METADATA_CLEAR_CACHE: 'metadata:clearCache',
  METADATA_PROGRESS_EVENT: 'metadata:progressEvent',

>>>>>>> Stashed changes
  // System & Window
  SYSTEM_GET_INFO: 'system:getInfo',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
