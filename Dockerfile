FROM node:24-alpine AS base
WORKDIR /app

RUN npm install -g pnpm@10.14.0

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY pnpm-lock.yaml ./

RUN pnpm install

FROM base AS build
WORKDIR /app

COPY . .

RUN pnpm --filter @axon/backend run prisma:generate

FROM base AS development
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages

EXPOSE 3001
