# Read-only TradeLink Google Drive knowledge

Approved folder: https://drive.google.com/drive/folders/1DnzWOYD2g-OXv2IsVFLJRWtqF2-qQsJ3

The adapter is implemented; live access is not established until a dedicated credential is saved and a first sync succeeds. This connection is for the deployed CMO app, separate from any Google Drive connector in ChatGPT.

## Account authorization

1. In an owner-controlled Google Cloud project, enable **Google Drive API**. Do not change billing or purchase services.
2. Create a dedicated service account named `tradelink-cmo-drive-reader`. Grant **no project IAM roles** and no domain-wide delegation. Do not reuse an account with access to other private resources.
3. Create its JSON key. Treat the entire file as a secret. Put the JSON directly in Railway → tradelink-cmo → web → production → Variables → `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`. Never put it in chat, screenshots, source control or client variables. If a browser agent cannot transfer it securely, let the owner paste it directly into Railway. Remove temporary downloaded key material after securely saving it, when permitted.
4. In Google Drive, share only the approved folder with the service account's `client_email` as **Viewer**. Keep link sharing restricted; do not make the folder public. Viewer access normally inherits to children, but separately restricted files may still be inaccessible. If organization policy blocks external service accounts or key creation, report the blocker; do not weaken organization policies.
5. Save the variable without deployment, then ask the coding session to activate and verify. Existing credentials must not be overwritten without checking their intended use.
6. After deployment, sign in to the CMO → **Knowledge base → Google Drive reference folder → Sync Drive read-only**. Confirm the folder name, document titles, source links and contents. Authorization alone does not establish a successful import. Further edits require another explicit sync; there is no scheduler.

The server signs a short-lived RS256 JWT for `https://www.googleapis.com/auth/drive.readonly`, exchanges it only with `https://oauth2.googleapis.com/token`, then reads only `https://www.googleapis.com/drive/v3/` endpoints. It never delegates a human identity. Do not share other folders with this dedicated identity: the API scope is read-only, while the folder sharing and fixed application root constrain which data it can read.

## Supported content and bounds

- Google Docs exported as plain text; UTF-8 plain-text and Markdown files. Formatting, embedded images, comments and revision history are not imported.
- Recurses up to five nested folder levels under the approved folder. Every listed file's parent is checked against its traversed folder. Shortcuts are skipped, so they cannot escape the hierarchy.
- PDFs, Word files, spreadsheets, presentations, images, video and all other formats are skipped and counted. Convert a needed document to Google Docs or plain text to include it in this version.
- Maximum 100 entries (including folders/unsupported files), 50 imported documents, 100 KB per downloaded/exported document, complete text retained within the 100 KB per-document limit, 500,000 retained characters total, 160 Drive requests and a 90-second overall deadline. Exceeding a hard bound aborts the import rather than saving a partial folder scan.
- Listings are paginated; repeated cursors, incomplete searches, account/access errors and malformed metadata fail closed. No redirects, third-party download links or shortcut targets are followed. Google reads are not a transactional snapshot: concurrent edits can change content during capture. The recorded modification time comes from the listing.

## Persistence, evidence and removal

PostgreSQL stores source IDs, titles, paths, modification timestamps, sync timestamps, text and truncation flags in `DriveDocument`; `DriveSync` stores the last successful state. An entirely successful scan atomically replaces only that folder's imported reference documents. Files removed from the hierarchy are removed from that active import on the next successful sync. Manual knowledge, experiments, billing data and institutional memory remain separate and editable through their own workflows. There are no Drive writes.

A failed scan retains cached documents but pauses direct Drive-reference retrieval until a successful scan. Removing the credential also disables direct retrieval. Previously generated chats/reports or manually copied knowledge are retained; they are not a revocation or data-erasure mechanism and may still contain earlier excerpts.

CMO evidence uses up to eight documents selected by title/content keyword matching against the user's prompt (ties keep modification order), with up to 4,000 characters per document around the first match. This is bounded lexical retrieval, not full-folder analysis, OCR or a semantic/vector search engine. Local evidence reports show shorter previews. Ask about a specific document/topic to improve selection; the app labels excerpts and retains source links/timestamps. Imported documents can be drafts or conflicting material: review source context rather than assuming everything is approved company policy. Document text is untrusted reference data and cannot grant tools or change the human approval boundary.

When OpenAI is selected, selected document text is sent to OpenAI along with the existing workspace evidence. Local evidence mode does not call OpenAI. The Knowledge base UI explicitly discloses this.

## Security and verification

Only authenticated ADMIN users can initiate a same-origin POST sync. Client-selected folders and extra request-body fields are rejected. A PostgreSQL-backed three-minute lease limits repeated/concurrent requests across replicas. Request/success/sanitized-failure audits contain no keys, OAuth tokens, document text or raw upstream errors. There is no auto-refresh token storage, background job, publishing or file modification/deletion API.

Unit fixtures verify JWT signature/read-only scope, non-delegation, fixed origins, descendant boundaries, pagination, unsupported types, missing permissions, size limits, redaction and evidence selection. Database fixtures verify atomic replacement, preservation of manual knowledge, cooldown and fail-closed retrieval. Browser tests cover setup status and mobile/dark rendering. Live verification requires the owner's account authorization above.

## Live activation

Owner-approved activation was verified on October 18, 2026 (Eastern). The first successful folder import stored **10 supported documents** and skipped **45 unsupported files**. The configured adapter is now included in Sync all and the daily 4am Eastern schedule. The first import used a one-time deployment verification command that was subsequently removed. Keep the existing working credential; no replacement or regeneration is needed. File-type support and excerpt limits above still apply.

## Recursive content review

An owner-requested `node --import tsx scripts/review-drive-everything.ts --apply` refreshes the entire approved hierarchy, records folder/file inventory, and reviews each file. It uses the existing Viewer service account and OpenAI account; no broader scopes, public sharing, Drive writes or external action executor is added.

- Text: complete imported Docs/plain text/Markdown.
- Sheets: Drive exports XLSX; a bounded ZIP/XML parser reads cached values and formulas across every worksheet, including hidden tabs. It never evaluates formulas or follows external links. Charts, drawings and comments are not interpreted. Original files remain unchanged. Limits: 2,000 archive entries, 100 MB total uncompressed, 200,000 cells and one million extracted characters; unsafe DTD/entity XML is rejected.
- PNG/JPEG: visual analysis of a rendered preview up to 1600px. Transparency is shown on neutral gray; fine print may be unreadable.
- Photoshop: flattened composite preview; hidden layers, alternate states, editable text and off-canvas elements remain unreviewed. Marked PARTIAL.
- MP4: at most 60 frames sampled across the complete timeline (approximately every second for short clips, less often for longer clips) plus full audio transcription where possible. Videos over 10 minutes are blocked. Reviews are marked PARTIAL because continuous motion and unsampled frames are not read; failed audio transcription is disclosed.

Download bounds are 30 MB for ordinary files, 100 MB for PSD, 150 MB for video and 500 MB per run. Each download revalidates ID, MIME type, revision, parent membership and download permission against the scanned inventory, uses fixed Google API endpoints and prohibits redirects. Parsing/rendering runs without a shell, with time/resource bounds, private temporary files and cleanup. Runtime media tools are installed by the Dockerfile (`ffmpeg`, `imagemagick`, `python3`).

File-specific summaries, timestamps and coverage are saved in institutional memory. A human-readable file-by-file report appears under Briefs & plans. A coverage memory explicitly distinguishes REVIEWED, PARTIAL and FAILED. Successful matching-version/revision reviews can resume without repeating API calls. Daily scheduled Drive sync refreshes text/inventory only; it does not automatically run paid model/media reviews. One-time review commands must be cleared from Railway pre-deploy settings after use. The requested Today plan is refreshed from saved reviews; the prior plan/tasks remain recoverable in the archive.
