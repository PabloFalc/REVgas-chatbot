# syntax=docker/dockerfile:1

FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM alpine:3.22 AS release
RUN apk add --no-cache libstdc++ libgcc \
    && addgroup -S app && adduser -S -G app -H app
WORKDIR /app
COPY --from=build /app/dist/revgas-chatbot ./revgas-chatbot
ENV NODE_ENV=production
USER app
EXPOSE 3000
CMD ["./revgas-chatbot"]
