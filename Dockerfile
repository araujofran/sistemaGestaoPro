FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
COPY server.js ./server.js
ENV NODE_ENV=production PORT=4173
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4173/api/health || exit 1
USER node
CMD ["node", "server.js"]
