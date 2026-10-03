# The context is dist/standby-release, never the repository or a recovery folder.
FROM node:22-bookworm-slim
ENV NODE_ENV=production STANDBY_MODE=locked PORT=10000
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 10000
CMD ["node", "runtime/server.mjs"]
