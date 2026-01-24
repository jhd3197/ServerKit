package logger

import (
	"io"
	"os"
	"path/filepath"

	"github.com/serverkit/agent/internal/config"
	"gopkg.in/natefinch/lumberjack.v2"
	"log/slog"
)

// Logger wraps slog.Logger with additional context
type Logger struct {
	*slog.Logger
}

// New creates a new logger with the given configuration
func New(cfg config.LoggingConfig) *Logger {
	var level slog.Level
	switch cfg.Level {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	var writers []io.Writer

	// Always write to stdout
	writers = append(writers, os.Stdout)

	// Also write to file if configured
	if cfg.File != "" {
		// Ensure log directory exists
		dir := filepath.Dir(cfg.File)
		if err := os.MkdirAll(dir, 0755); err == nil {
			// Use lumberjack for log rotation
			fileWriter := &lumberjack.Logger{
				Filename:   cfg.File,
				MaxSize:    cfg.MaxSize, // megabytes
				MaxBackups: cfg.MaxBackups,
				MaxAge:     cfg.MaxAge, // days
				Compress:   cfg.Compress,
			}
			writers = append(writers, fileWriter)
		}
	}

	// Create multi-writer
	multiWriter := io.MultiWriter(writers...)

	handler := slog.NewJSONHandler(multiWriter, opts)
	logger := slog.New(handler)

	return &Logger{Logger: logger}
}

// With returns a new logger with additional attributes
func (l *Logger) With(args ...any) *Logger {
	return &Logger{Logger: l.Logger.With(args...)}
}

// WithComponent returns a logger with a component name
func (l *Logger) WithComponent(name string) *Logger {
	return l.With("component", name)
}
