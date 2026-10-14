# App Review merchant credential reset — 23 September 2026

At the owner's explicit request, reset the existing DEMO — Loja Centro login
after the previous clipboard-only credentials were lost. No new merchant or
login was created; catalog data and all other accounts were unchanged.

- Read-only preflight verified the existing September 21 rotation audit marker,
  exact user/merchant IDs, active store and `demo-loja-centro` slug.
- Generated a random username and 32-character password in memory; reused the
  existing PasswordService salted scrypt hash through a Nest provider.
- Used the provisioning advisory lock, user row lock, active merchant check and
  expected prior revision/hash. Updated exactly one user and reset attempts.
- Revoked its sessions in the same transaction; zero sessions existed to revoke.
- Copied both new credentials to the owner's clipboard and verified equality
  without printing them or writing any plaintext credential file.
- Production HTTPS login returned 200, authenticated `/merchant/auth/me`
  confirmed the expected merchant, and the smoke session was logged out (204).
- Final clipboard verification completed at `2026-09-23T14:06:50.468Z`.

Only the salted password hash is stored in the database. The owner must save
the clipboard contents in a password manager and enter them into App Review's
private sign-in fields. Logging in again ends the previous merchant session;
avoid sharing concurrent access while Apple reviews. No deployment, migration,
App Store submission, commit or push occurred in this reset.
