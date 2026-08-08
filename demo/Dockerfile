# node:sqlite (DatabaseSync) is unstable before 22.5 and the app will not boot
# on 20. Pinned to a minor rather than :22 so a base image refresh cannot move
# the SQLite implementation under a live database.
FROM node:22.22-slim

ENV NODE_ENV=production

WORKDIR /app

# Dependencies first, so editing source does not re-resolve the tree on every
# build. Both @grpc packages are pure JavaScript, so no compiler is needed and
# the slim image stays slim.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Everything stateful lives on the mounted volume, never in the image layer. A
# path inside the image looks like it works and is silently discarded on each
# deploy, taking every account's data with it.
ENV BOTLIEN_DB=/data/botlien.db \
    BOTLIEN_CONTROL_DB=/data/control.db \
    BOTLIEN_TENANT_DIR=/data/tenants \
    BOTLIEN_PORT=8080 \
    BOTLIEN_HOST=0.0.0.0

# Binding 127.0.0.1 inside a container accepts only connections from within the
# container itself, so the platform's health check fails and the machine is
# restarted forever with the app working perfectly the whole time.
EXPOSE 8080

# Runs as root. A fresh Fly volume mounts root-owned, and dropping privileges
# properly needs an entrypoint that chowns then re-execs, which slim has no
# su-exec for. Acceptable for a pilot on a single machine; on the phase 2
# security pass this becomes a non-root user with the volume chowned at boot.
CMD ["node", "src/index.mjs"]
