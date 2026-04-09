package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type Level int

const (
	LevelError Level = iota
	LevelWarn
	LevelInfo
	LevelDebug
)

type Logger struct {
	level    Level
	bindings map[string]interface{}
}

func New(level Level) *Logger {
	return &Logger{level: level, bindings: make(map[string]interface{})}
}

func (l *Logger) Child(key string, value interface{}) *Logger {
	bindings := make(map[string]interface{}, len(l.bindings)+1)
	for k, v := range l.bindings {
		bindings[k] = v
	}
	bindings[key] = value
	return &Logger{level: l.level, bindings: bindings}
}

func (l *Logger) log(level Level, levelStr string, msg string, fields map[string]interface{}) {
	if level > l.level {
		return
	}

	entry := make(map[string]interface{}, len(l.bindings)+len(fields)+3)
	for k, v := range l.bindings {
		entry[k] = v
	}
	for k, v := range fields {
		entry[k] = v
	}
	entry["level"] = levelStr
	entry["message"] = msg
	entry["timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	data, _ := json.Marshal(entry)
	if level <= LevelError {
		fmt.Fprintln(os.Stderr, string(data))
	} else {
		fmt.Fprintln(os.Stdout, string(data))
	}
}

func (l *Logger) Error(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log(LevelError, "error", msg, f)
}

func (l *Logger) Warn(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log(LevelWarn, "warn", msg, f)
}

func (l *Logger) Info(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log(LevelInfo, "info", msg, f)
}

func (l *Logger) Debug(msg string, fields ...map[string]interface{}) {
	f := mergeFields(fields)
	l.log(LevelDebug, "debug", msg, f)
}

func mergeFields(fields []map[string]interface{}) map[string]interface{} {
	if len(fields) == 0 {
		return nil
	}
	return fields[0]
}
