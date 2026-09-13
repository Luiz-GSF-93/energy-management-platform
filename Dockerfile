FROM node:20-alpine AS builder
WORKDIR /app

# Copiar package.json e package-lock.json
COPY backend/package.json ./
COPY backend/package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copiar código fonte
COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY backend/tsconfig.build.json ./

# Build
RUN npm run build

# Stage final
FROM node:20-alpine
WORKDIR /app

# Instalar Nest CLI globalmente (opcional)
RUN npm install -g @nestjs/cli

# Copiar arquivos compilados e node_modules da build anterior
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Criar diretório para uploads
RUN mkdir -p /app/uploads/documents

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/v1/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Iniciar aplicação
CMD ["node", "dist/main"]
