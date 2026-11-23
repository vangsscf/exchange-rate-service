FROM node:24-bookworm-slim AS build

WORKDIR /usr/app

COPY package*.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /usr/app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /usr/app/build ./build

CMD ["node", "build/main.js"]
