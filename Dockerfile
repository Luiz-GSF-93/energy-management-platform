# Builder stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY backend/package.json ./

RUN npm install

COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY backend/nest-cli.json ./

RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["npm", "start"]
