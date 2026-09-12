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

  // Downloads
  DOWNLOADS_GET_ALL: 'downloads:getAll',
  DOWNLOADS_QUEUE: 'downloads:queue',
  DOWNLOADS_CANCEL: 'downloads:cancel',

  // Settings
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',

  // System & Window
  SYSTEM_GET_INFO: 'system:getInfo',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
