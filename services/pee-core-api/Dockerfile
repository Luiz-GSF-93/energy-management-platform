FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PEE_CORE_ENABLED=false
ENV PEE_ACCESS_ENABLED=false
ENV PEE_PROJECTS_ENABLED=false
COPY --chown=node:node package.json server.mjs server-enabled.mjs disabled-mode.mjs gateway.mjs contract-template.mjs supabase-auth.mjs access-server.mjs core-transport.mjs session-seal.mjs application.mjs store.mjs project-policy.mjs engineering.mjs reports.mjs project-detail.mjs evaluation.mjs scoring.mjs brand.mjs official-sources.mjs audit.mjs project-progress.mjs ./
COPY --chown=node:node web/ ./web/
USER node
CMD ["node", "server.mjs"]
