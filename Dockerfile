FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    GATEWAY_PORT=4000 \
    GATEWAY_HOST=0.0.0.0

COPY package.json server.js ./
COPY public ./public

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:4000/api/sistemas" || exit 1

CMD ["node", "server.js"]
