# Vendored Bear Robotics protos

**Already vendored** (see `VENDORED.txt` for the exact upstream commit):
`bearrobotics/api/v1/**` plus the `google/api` annotation dependencies, taken
from the public repo https://github.com/bearrobotics-public/cloud (MPL-2.0,
license preserved in `BEAR-PROTOS-LICENSE`).

The connector (`createGrpcStreamFactory` in `src/connectors/bear.mjs`) walks
this directory recursively at runtime and finds the service exposing
`SubscribeRobotStatus` (`bearrobotics.api.v1.services.cloud.APIService`), so
package renames upstream won't break the loader. `test/bear.test.mjs` includes
a smoke test that the vendored protos parse and the service resolves.

## Refreshing

```bash
git clone --depth 1 https://github.com/bearrobotics-public/cloud /tmp/bear-cloud
rm -rf proto/bear/bearrobotics/api/v1
cp -R /tmp/bear-cloud/bearrobotics/api/v1 proto/bear/bearrobotics/api/v1
# update VENDORED.txt with the new commit hash
```

## Going live

Create `.claude/secrets.local.json` (gitignored):

```json
{
  "bear": {
    "credentials": { /* the credentials JSON Bear issues for authorizeApiAccess */ }
  }
}
```

Then `npm start`. Auth is JWT via `https://api-auth.bearrobotics.ai/authorizeApiAccess`;
robot listing is REST; status streaming is gRPC server-streaming.
