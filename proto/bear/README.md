# Vendored Bear Robotics protos

The Bear connector loads any `.proto` files in this directory at runtime
(`createGrpcStreamFactory` in `src/connectors/bear.mjs`) and finds the service
exposing `SubscribeRobotStatus` automatically, so exact package names don't
matter.

To vendor the protos:

1. Bear's public API artifacts live at https://gitlab.com/bearrobotics-public
   (the `api-client` repo and the API docs at
   https://cloud.api.bearrobotics.ai/guides/getting-started/).
2. Copy the `.proto` files for the Cloud API (RobotStatus, Mission, and their
   dependencies) into this directory, preserving any relative import paths.
3. `npm start` will pick them up once `.claude/secrets.local.json` contains:

```json
{
  "bear": {
    "credentials": { /* the credentials JSON Bear issues for authorizeApiAccess */ }
  }
}
```

Until real credentials exist, everything runs against the simulator
(`npm run demo`) and the Bear connector is exercised in tests via a fake
stream (`test/bear.test.mjs`).
