FROM node:20-alpine AS builder
WORKDIR /app

COPY backend/package.json ./
RUN npm install --legacy-peer-deps

COPY backend/src ./src
COPY backend/tsconfig.json .
COPY backend/tsconfig.build.json .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

RUN npm install -g @nestjs/cli
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001
CMD ["node", "dist/main"]
