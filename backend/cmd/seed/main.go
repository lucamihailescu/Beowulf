package main

import (
	"context"
	"encoding/json"
	"log"

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

	namespaceRepo := storage.NewNamespaceRepo(db)
	appRepo := storage.NewApplicationRepo(db)
	policyRepo := storage.NewPolicyRepo(db)
	entityRepo := storage.NewEntityRepo(db)

	// Create or get the demo namespace
	nsID, err := namespaceRepo.Create(ctx, "Demo", "Demo namespace for sample data")
	if err != nil {
		// Namespace might already exist, try to get it
		ns, getErr := namespaceRepo.GetByName(ctx, "Demo")
		if getErr != nil || ns == nil {
			log.Fatalf("create namespace: %v", err)
		}
		nsID = ns.ID
	}
	log.Printf("using namespace id=%d", nsID)

	appID, err := appRepo.Create(ctx, "demo-app", nsID, "Demo application", false)
	if err != nil {
		log.Fatalf("create app: %v", err)
	}
	log.Printf("using application id=%d", appID)

	policyText := `permit (
	principal == User::"alice",
	action == Action::"view",
	resource == Document::"demo-doc"
);`

	_, _, _, err = policyRepo.UpsertPolicyWithVersion(ctx, appID, "allow-view", "Demo allow view", policyText, true)
	if err != nil {
		log.Fatalf("seed policy: %v", err)
	}

	userAttrs, _ := json.Marshal(map[string]any{"email": "alice@example.com"})
	if err := entityRepo.UpsertEntity(ctx, appID, "User", "alice", userAttrs, nil); err != nil {
		log.Fatalf("seed user: %v", err)
	}

	docAttrs, _ := json.Marshal(map[string]any{"owner": "alice"})
	if err := entityRepo.UpsertEntity(ctx, appID, "Document", "demo-doc", docAttrs, nil); err != nil {
		log.Fatalf("seed document: %v", err)
	}

	if err := entityRepo.UpsertEntity(ctx, appID, "Action", "view", json.RawMessage(`{}`), nil); err != nil {
		log.Fatalf("seed action: %v", err)
	}

	log.Println("seed complete")
	// machine-readable output for scripts
	log.Printf("APP_ID=%d", appID)
}
