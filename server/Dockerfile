FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM build AS migrator
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG APP_VERSION=0.2.0-rc.2
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force \
  && rm -rf /root/.npm
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
