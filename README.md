# ChurchApps Integrations

Connector apps that run on third-party platforms and talk to the B1 API. One folder per platform; each is self-contained with its own deploy flow.

| Folder | Platform | Deploys via |
|--------|----------|-------------|
| [zapier/](zapier/) | Zapier (official B1.church app) | `zapier push` |

Shared building blocks (REST client, OAuth, webhook verifier) live in [`@churchapps/integration-sdk`](https://www.npmjs.com/package/@churchapps/integration-sdk), not here. User-facing setup docs live in [ChurchAppsSupport/docs/b1-admin/integrations/](../ChurchAppsSupport/docs/b1-admin/integrations/).
