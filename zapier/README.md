# B1.church Zapier App

The official B1.church integration for Zapier, built with the Zapier CLI (`zapier-platform-core`). User-facing docs: [ChurchAppsSupport/docs/b1-admin/integrations/zapier.md](../../ChurchAppsSupport/docs/b1-admin/integrations/zapier.md).

## Surface

- **Triggers (REST hooks):** New Person, Updated Person, New Donation, New Group Member, New Form Submission. Turning a Zap on POSTs `/membership/webhooks` (needs an API key with `settings:write`); turning it off deletes the webhook.
- **Actions:** Create Person, Add Donation (with optional fund allocation), Add Group Member.
- **Search:** Find Person (by id, email, or name).

Auth is a `cak_…` API key from B1Admin (**Settings → Developer → API Keys**), sent as `Authorization: Bearer`. An optional API URL field supports self-hosted installations.

## Develop

```bash
npm test                     # offline unit tests — no install needed
npm install                  # only needed for zapier CLI commands
npx zapier-platform validate # schema check
```

`platformVersion` in `index.js` must exactly match the `zapier-platform-core` version in `package.json` — bump both together.

## Deploy

One-time: `npm i -g zapier-platform-cli`, `zapier-platform login`, then from this folder `zapier-platform register "B1.church"` (creates `.zapierapprc`, not committed). (CLI v19 renamed the binary from `zapier` to `zapier-platform`.)

Each release:

```bash
zapier-platform push
zapier-platform promote <version>
```

Keep `version` in `package.json` bumped per push. The app should be published as a public integration so churches find it in the Zap editor; until then, invite users with `zapier-platform users:add`.
