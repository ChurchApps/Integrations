# B1.church Zapier App

The official B1.church integration for Zapier, built with the Zapier CLI (`zapier-platform-core`). User-facing docs: [ChurchAppsSupport/docs/b1-admin/integrations/zapier.md](../../ChurchAppsSupport/docs/b1-admin/integrations/zapier.md).

## Surface

- **Triggers (REST hooks):** one per webhook event in the Api's `WebhookEvents.ts` (25), generated from the `TRIGGERS` table in `index.js`.
  - People: New Person, Updated Person, Deleted Person
  - Groups: New Group, Updated Group, Deleted Group, New Group Member, Removed Group Member, New Group Join Request
  - Households: New Household, Updated Household, Deleted Household
  - Giving: New Donation, Updated Donation
  - Attendance: New Attendance Record, New Attendance Checkout, New Attendance Session
  - Forms: New Form Submission
  - Events: New Event, Updated Event, Deleted Event, New Registration, Cancelled Registration
  - Lists: New List Member, Removed List Member

  Turning a Zap on POSTs `/membership/webhooks` (needs an API key with `settings:write`); turning it off deletes the webhook. Test data comes from a REST list where one returns rows shaped like the hook payload (people, groups, group members, households, donations, form submissions), and from the static sample for every other event.
- **Actions:** Create Person, Update Person, Add Donation (with optional fund allocation), Add Group Member, Remove Group Member, and Find Person as an action (it can be a Zap's last step, and fails the task if nobody matches).
- **Searches:** Find Person (by id, email, or name) and Find Group (by exact name). Find or Create Person pairs the Find Person search with Create Person.

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
