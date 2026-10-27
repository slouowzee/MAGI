FROM oven/bun:1.4.2-alpine

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit optional

COPY src ./src
COPY assets ./assets
RUN mkdir -p data && chown bun:bun data
USER bun

CMD ["bun", "src/index.js"]
