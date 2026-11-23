FROM node:24-alpine AS web-deps
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM web-deps AS web-build
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS go-deps
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download

FROM go-deps AS go-build
COPY server/ ./
ENV CGO_ENABLED=0
RUN go test ./... && go build -trimpath -ldflags="-s -w" -o /bin/relevo .

FROM alpine:3.23
WORKDIR /srv
RUN addgroup -g 1000 relevo && adduser -D -H -u 1000 -G relevo relevo && mkdir -p /data && chown relevo:relevo /data
COPY --from=go-build /bin/relevo /srv/relevo
COPY --from=web-build /src/dist/ /srv/web/
USER 1000:1000
ENV DB_PATH=/data/relevo.sqlite WEB_DIR=/srv/web ADDR=:8080
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s --start-period=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/srv/relevo"]

