# Build: install all dependencies and bundle the client (dist/public), the server
# (dist/index.js) and the SQL migrations it applies at boot (dist/migrations).
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Runtime: production dependencies and dist/ only, run as the unprivileged `node` user.
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Without R2, images go to local disk only with UPLOAD_DIR set (e.g. /app/uploads on a volume), so `node` must be able to write here.
RUN mkdir -p uploads && chown node:node uploads

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
