FROM node:22.22.3-alpine AS base
RUN npm install --global npm@11.19.1

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/api ./apps/api
# Prisma generation validates this setting but does not connect to a database.
# Do not provide a real database URL or copy an environment file during builds.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npm run build

FROM dependencies AS migrations
ENV NODE_ENV=production
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
WORKDIR /app/apps/api
CMD ["npm", "run", "db:migrate:deploy"]

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
