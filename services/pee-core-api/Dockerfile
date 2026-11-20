FROM node:24-alpine
RUN apk add --no-cache poppler-utils
WORKDIR /app
ENV NODE_ENV=production
ENV PEE_CORE_ENABLED=false
ENV PEE_ACCESS_ENABLED=false
ENV PEE_PROJECTS_ENABLED=false
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node submission-notifications.mjs network-address.mjs sales-policy.mjs sales-mails.mjs client-portal.mjs document-control.mjs document-viewer.mjs portfolio.mjs ./
RUN npm ci --omit=dev --ignore-scripts --strict-ssl=true
COPY --chown=node:node zip.mjs report-documents.mjs eva-policy.mjs server.mjs server-enabled.mjs disabled-mode.mjs gateway.mjs contract-template.mjs supabase-auth.mjs access-server.mjs core-transport.mjs session-seal.mjs application.mjs store.mjs project-policy.mjs engineering.mjs reports.mjs project-detail.mjs evaluation.mjs scoring.mjs brand.mjs official-sources.mjs audit.mjs project-progress.mjs communications.mjs communications-policy.mjs resend-provider.mjs mail-attachments.mjs document-signatures.mjs project-package.mjs distributor-contact.mjs licensed-policy.mjs licensed-identity.mjs license-notices.mjs ./
COPY --chown=node:node web/ ./web/
USER node
CMD ["node", "server.mjs"]
