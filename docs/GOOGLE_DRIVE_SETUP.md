# Google Drive Setup Guide for Game Vault

This guide walks you through configuring Google Cloud Console to enable Google Drive integration in Game Vault with secure OAuth 2.0 Desktop authentication and least-privilege permissions.

---

## 1. Overview & Security Architecture

Game Vault uses **OAuth 2.0 with PKCE (Proof Key for Code Exchange)** and a local HTTP loopback server (http://127.0.0.1:<port>/oauth2callback) as recommended by [RFC 8252 (OAuth 2.0 for Native Apps)](https://tools.ietf.org/html/rfc8252).

### Principles:
- **Zero Ingestion of Rclone:** Game Vault communicates directly with Google Drive API v3 via native Node.js HTTP/TLS streams.
- **Least Privilege Access:** Game Vault asks **only** for read-only Drive access (drive.readonly) and basic profile info (userinfo.profile, userinfo.email). Game Vault can never delete, modify, or overwrite your cloud files.
- **OS-Level Credential Protection:** OAuth tokens (access tokens and refresh tokens) are encrypted using **Windows DPAPI** via Electron safeStorage (with AES-256-GCM fallback). Tokens are **never** stored in SQLite or exposed to the React frontend/renderer process.
- **Multi-Account Native Support:** You can link multiple independent Google accounts (e.g., Personal Games, Archived ROMs) with unified quota aggregation and individual management.

---

## 2. Step-by-Step Google Cloud Console Setup

### Step 1: Create a Google Cloud Project
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top of the page and select **New Project**.
3. Name your project (e.g., Game Vault) and click **Create**.
4. Make sure your newly created project is selected in the top bar.

### Step 2: Enable the Google Drive API
1. In the left navigation menu, go to **APIs & Services** > **Enabled APIs & Services**.
2. Click **+ ENABLE APIS AND SERVICES** at the top.
3. In the search box, type Google Drive API.
4. Click on **Google Drive API** and click **Enable**.

### Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** user type (unless you have a Google Workspace domain) and click **Create**.
3. Fill in the required application details:
   - **App name:** Game Vault
   - **User support email:** Select your Google account email.
   - **Developer contact information:** Enter your email address.
4. Click **Save and Continue**.
5. **Scopes configuration:**
   - Click **Add or Remove Scopes**.
   - Search for and select the following scopes:
     - .../auth/drive.readonly — View files and metadata in your Google Drive.
     - .../auth/userinfo.profile — See your personal info (display name and avatar).
     - .../auth/userinfo.email — See your primary Google Account email address.
   - Click **Update** then **Save and Continue**.
6. **Test Users (Crucial for Personal Projects):**
   - Since your app is in Testing mode, Google requires you to explicitly whitelist accounts allowed to log in.
   - Click **+ ADD USERS**.
   - Enter your personal Google email address(es) that you intend to connect to Game Vault (e.g. your-email@gmail.com, plus any secondary accounts).
   - Click **Add**, then **Save and Continue**.
7. Review your summary and click **Back to Dashboard**.

### Step 4: Create OAuth 2.0 Desktop Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top and select **OAuth client ID**.
3. Under **Application type**, select **Desktop app**.
4. In the **Name** field, enter Game Vault Desktop Client.
5. Click **Create**.
6. A dialog box will appear with your **Client ID** and **Client Secret**.
   - Keep this dialog open or copy both values.

> [!NOTE]
> Why Desktop app? Per Google OAuth specifications and RFC 8252, Desktop App client IDs are authorized to receive loopback callbacks on http://127.0.0.1:<any_port>/oauth2callback without needing to pre-register redirect URIs.

---

## 3. Configuring Game Vault

1. In your Game Vault project root, copy .env.example to .env:
   `ash
   cp .env.example .env
   `
2. Open .env in an editor and insert your credentials:
   `ini
   GAMEVAULT_GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
   GAMEVAULT_GOOGLE_CLIENT_SECRET=GOCSPX-yourSecretStringHere
   `
3. Save the file.

> [!IMPORTANT]
> The .env file is included in .gitignore to protect your credentials. Never commit your .env file to Git!

---

## 4. Connecting Accounts in the App

1. Launch Game Vault:
   `ash
   npm run dev
   `
2. In the navigation sidebar, click on **Storage** (or the Cloud Storage card on the Home dashboard).
3. Click **Connect Account**.
4. Choose **Google Drive** and enter a friendly name for this account (e.g. Ryan Principal 5 TB).
5. Click **Connect**.
6. Your default web browser will open Google\'s authorization page:
   - Select your Google Account.
   - If a warning Google hasn\'t verified this app appears (normal for personal test apps), click **Advanced** -> **Go to Game Vault (unsafe)**.
   - Review permissions (Read-only Drive access, profile info).
   - Click **Continue** / **Allow**.
7. The browser tab will confirm: *Authentication Successful! You can close this tab and return to Game Vault.*
8. Game Vault automatically saves the encrypted credentials, queries account quota and email, and lists the account as **CONNECTED** with live storage quota tracking.
9. To connect a second account (e.g. Ryan Archive 5 TB), click **Connect Account** again and select your second Google Account.

---

## 5. Troubleshooting & FAQ

### Access blocked: Game Vault has not completed the Google verification process
- **Cause:** Your OAuth consent screen is in Testing mode and the Google account you are logging into is not registered in the Test Users list.
- **Fix:** Go to Google Cloud Console > **APIs & Services** > **OAuth consent screen** > **Test users**, and add the email address you are attempting to log into.

### Error 400: redirect_uri_mismatch
- **Cause:** The OAuth Client was created as Web application instead of Desktop app.
- **Fix:** Go to **Credentials**, delete the client, create a new one, and select **Application type: Desktop app**.

### Disconnecting or Reconnecting an Account
- To disconnect: Click the trash/disconnect icon next to the account in the **Storage** screen. The encrypted credentials are deleted from Windows DPAPI immediately.
- To reconnect: If a session expires or is revoked, click **Reconnect** to initiate a new authorization flow for that account.
