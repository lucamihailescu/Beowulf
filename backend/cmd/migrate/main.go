package main

import (
	"context"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"

	"github.com/joho/godotenv"

	"cedar/internal/config"
	"cedar/internal/storage"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()
	ctx := context.Background()

	db, err := storage.NewDB(ctx, cfg.DBURL, "", 0, 0)
	if err != nil {
		log.Fatalf("failed to connect to postgres: %v", err)
	}
	defer db.Close()

	files, err := readMigrationFiles("./migrations")
	if err != nil {
		log.Fatalf("read migrations: %v", err)
	}

	for _, f := range files {
		log.Printf("applying migration %s", f.name)
		if _, err := db.Writer().Exec(ctx, f.content); err != nil {
			log.Fatalf("apply %s: %v", f.name, err)
		}
	}

	log.Printf("migrations applied (%d files)", len(files))
}

type migrationFile struct {
	name    string
	content string
}

func readMigrationFiles(dir string) ([]migrationFile, error) {
	entries := []migrationFile{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".sql" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		entries = append(entries, migrationFile{name: filepath.Base(path), content: string(data)})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	return entries, nil
}
