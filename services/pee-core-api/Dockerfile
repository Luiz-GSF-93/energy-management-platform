FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PEE_CORE_ENABLED=false
COPY --chown=node:node package.json server.mjs server-enabled.mjs disabled-mode.mjs gateway.mjs contract-template.mjs supabase-auth.mjs ./
USER node
CMD ["node", "server.mjs"]
