// Локальный движок IDE Code: всё на устройстве пользователя.
package main

import (
	"astracode/backend/internal/local"
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	cfg := local.EnvConfig()
	engine, err := local.New(cfg)
	if err != nil {
		slog.Error("startup", "error", err)
		os.Exit(1)
	}
	defer engine.Close()

	server := &http.Server{
		Addr: cfg.Listen, Handler: engine.Handler(),
		ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 16384,
	}
	go func() {
		<-ctx.Done()
		stop, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = server.Shutdown(stop)
	}()
	slog.Info("listening", "address", cfg.Listen, "root", cfg.Root, "shell", cfg.Shell)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("http server", "error", err)
		os.Exit(1)
	}
}
