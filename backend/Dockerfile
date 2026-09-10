FROM golang:1.26-alpine AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM build AS test
CMD ["go", "test", "-race", "-count=1", "./..."]

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/api /usr/local/bin/astra-api
EXPOSE 8080
ENTRYPOINT ["astra-api"]
