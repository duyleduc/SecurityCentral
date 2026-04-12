FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production (nginx serving static files) ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback: all routes serve index.html
RUN echo 'server { \
  listen 80; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location /api/ { proxy_pass http://platform-api:3000; } \
  location /auth/ { proxy_pass http://platform-api:3000; } \
  location /v1/ { proxy_pass http://platform-api:3000; } \
  location /health { proxy_pass http://platform-api:3000; } \
  location /ws { proxy_pass http://platform-api:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
