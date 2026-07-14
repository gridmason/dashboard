# syntax=docker/dockerfile:1

# --- build stage: produce the static bundle -------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps against the lockfile first for cache reuse.
COPY package.json package-lock.json ./
RUN npm ci

# Build the static bundle (tsc --noEmit + vite build).
COPY . .
RUN npm run build

# --- serve stage: the deployable app image --------------------------------
# The dashboard publishes nothing to npm (FR-17); it ships as this image (the
# static bundle behind nginx) and the raw dist/ bundle.
FROM nginx:1.27-alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
