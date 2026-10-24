FROM node:24.21.0-alpine3.23

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
RUN mkdir -p data && chown node:node data
USER node

CMD ["node", "src/index.js"]
