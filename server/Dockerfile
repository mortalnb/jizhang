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

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG APP_VERSION=0.2.0-rc.1
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
