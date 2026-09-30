FROM node:24-alpine AS base
WORKDIR /app

RUN npm install -g pnpm@10.14.0

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY pnpm-lock.yaml ./
COPY patches/ ./patches/

RUN pnpm install

FROM base AS build
WORKDIR /app

COPY . .

RUN pnpm --filter @axon/api-contract build
RUN pnpm --filter @axon/backend run prisma:generate
RUN pnpm --filter @axon/backend build

# Runtime image: prod-only deps, the compiled backend (dist + generated
# Prisma client), the built contract package, and the migration files.
FROM base AS production
WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-contract/package.json ./packages/api-contract/
COPY pnpm-lock.yaml ./
COPY patches/ ./patches/

RUN pnpm install --prod

COPY --from=build /app/packages/api-contract/dist ./packages/api-contract/dist
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/src/prisma ./apps/backend/src/prisma

COPY apps/backend/alias-register.js ./apps/backend/alias-register.js
EXPOSE 3001

CMD ["sh", "-c", "pnpm exec prisma migrate deploy --schema /app/apps/backend/src/prisma/schema.prisma && node -r /app/apps/backend/alias-register.js /app/apps/backend/dist/src/main.js"]

FROM base AS development
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages

EXPOSE 3001
