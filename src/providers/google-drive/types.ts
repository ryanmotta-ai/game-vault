export interface GoogleDriveAuthConfig {
  clientId?: string;
  redirectUri?: string;
  scopes: string[];
}

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  parents?: string[];
  trashed?: boolean;
}
