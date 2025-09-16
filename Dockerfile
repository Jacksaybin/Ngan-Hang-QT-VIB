### Multi-stage Dockerfile
## Stage 1: Build static assets
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

## Stage 2: Production runtime (only prod deps + dist + server code needed)
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=build /app/dist ./dist
COPY server.js ./
COPY .env.example ./
EXPOSE 3000
CMD ["node","server.js"]
