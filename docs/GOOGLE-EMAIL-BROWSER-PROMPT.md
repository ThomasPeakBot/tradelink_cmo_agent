Set up the missing Google OAuth connection for the existing TradeLink CMO application. The code and template dashboard are already implemented. Do not build another app.

Sender: experience@peakbot.com — Google Workspace mailbox, not tradelink@peakbot.com.
App: https://cmo.usetradelink.com
Railway: tradelink-cmo → web → production.

1. In Google Cloud, choose an appropriate project and enable Gmail API. Create a dedicated Web application OAuth client for TradeLink CMO affiliate email. Preserve existing Drive service-account access and all other integrations. Do not grant domain-wide delegation, inbox access, Gmail modification, contacts access or broad IAM roles. Do not buy or upgrade anything.
2. Configure OAuth consent for the actual Workspace organization. Internal is appropriate only if available for the organization's users. If External is necessary, report its real testing/publishing/verification status; External Testing is not durable production authorization and refresh tokens can expire after seven days. Pause for owner interaction only where Google sign-in, organization policy or consent requires it; do not bypass verification or misrepresent status.
3. Authorized redirect URI must be exactly:
   https://cmo.usetradelink.com/api/affiliate-email/google/callback
   Authorized JavaScript origin, if requested: https://cmo.usetradelink.com
   Scopes requested by the app: openid, email, https://www.googleapis.com/auth/gmail.send. Do not add read/modify scopes.
4. Securely save GOOGLE_EMAIL_CLIENT_ID and GOOGLE_EMAIL_CLIENT_SECRET to Railway web production. Keep the existing AFFILIATE_EMAIL_ENCRYPTION_KEY unchanged, including sealed values; it was generated securely by the coding session. Never display, screenshot, paste in chat, commit or copy secrets into documents. Preserve existing Gmail/Drive/Stripe/X/Instagram/X Ads/OpenAI variables and APP_URL. Apply only these intended changes and deploy web. Do not commit unrelated staged changes.
5. Open the CMO → Affiliate communications → Connect Google mailbox. Have the owner authorize experience@peakbot.com itself. Another Google account or an alias is rejected deliberately. Verify the app shows the exact connected sender. Connection must leave automatic sending paused.
6. Do not approve templates, invent competition dates/rules/commissions, upload scraped/customer records, enable automation, run a live email test or email affiliates. The owner must review templates and official rules, supply permitted verified affiliate contact data, and explicitly enable automatic sending in the dashboard later.

Report: verified sender connected or precise blocker; OAuth consent status; variable names configured (no values); deployed service status; and confirmation that automation is paused and no emails were sent. Do not claim the separate affiliate data feed is connected; that private application's authenticated contract is still pending.
