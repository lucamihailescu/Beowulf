package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

type Config struct {
	InstallDir string
	User       string
	Group      string
	Env        map[string]string
}

const systemdTemplate = `[Unit]
Description=Cedar Backend Service
After=network.target postgresql.service redis.service

[Service]
Type=simple
User={{.User}}
Group={{.Group}}
WorkingDirectory={{.InstallDir}}
ExecStart={{.InstallDir}}/server
Restart=always
RestartSec=5
EnvironmentFile={{.InstallDir}}/.env
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`

func main() {
	configFile := flag.String("config", "", "Path to configuration file (optional)")
	flag.Parse()

	if *configFile != "" {
		fmt.Println("Config file support not yet implemented. Please use the wizard.")
		os.Exit(1)
	}

	runWizard()
}

func runWizard() {
	reader := bufio.NewReader(os.Stdin)
	config := Config{
		Env: make(map[string]string),
	}

	fmt.Println("Welcome to the Cedar Backend Installer")
	fmt.Println("======================================")
	fmt.Println("This wizard will help you configure and install the Cedar Backend.")
	fmt.Println()

	// Installation Directory
	config.InstallDir = prompt(reader, "Installation Directory", "/opt/cedar")
	config.User = prompt(reader, "Run as User", "cedar")
	config.Group = prompt(reader, "Run as Group", "cedar")

	fmt.Println("\n--- Database Configuration ---")
	config.Env["DATABASE_URL"] = prompt(reader, "Database URL (postgres://user:pass@host:port/db)", "postgres://cedar:cedar@localhost:5432/cedar?sslmode=disable")

	fmt.Println("\n--- Redis Configuration ---")
	config.Env["REDIS_ADDR"] = prompt(reader, "Redis Address", "localhost:6379")
	config.Env["REDIS_PASSWORD"] = prompt(reader, "Redis Password (leave empty if none)", "")

	fmt.Println("\n--- Application Configuration ---")
	config.Env["APP_PORT"] = prompt(reader, "Application Port", "8080")
	config.Env["API_KEY"] = prompt(reader, "API Key (for cluster communication)", "dev-secret-key")
	config.Env["AUTH_MODE"] = prompt(reader, "Authentication Mode (none, jwt, kerberos)", "none")
	config.Env["CORS_ALLOW_ORIGINS"] = prompt(reader, "CORS Allowed Origins", "*")

	// Generate files
	fmt.Println("\nGenerating configuration files...")

	// 1. Create Directory (if running as root, otherwise just warn)
	if err := os.MkdirAll(config.InstallDir, 0755); err != nil {
		fmt.Printf("Warning: Could not create directory %s: %v\n", config.InstallDir, err)
		fmt.Println("You may need to create it manually.")
	}

	// 2. Generate .env
	envPath := filepath.Join(config.InstallDir, ".env")
	if err := writeEnvFile(envPath, config.Env); err != nil {
		// If we can't write to the install dir, write to current dir
		fmt.Printf("Could not write to %s: %v. Writing to local .env instead.\n", envPath, err)
		envPath = ".env"
		if err := writeEnvFile(envPath, config.Env); err != nil {
			fmt.Printf("Error writing .env: %v\n", err)
			os.Exit(1)
		}
	}
	fmt.Printf("Generated configuration file at %s\n", envPath)

	// 3. Generate Systemd Service
	servicePath := "cedar-backend.service"
	if err := writeSystemdFile(servicePath, config); err != nil {
		fmt.Printf("Error writing systemd file: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Generated systemd service file at %s\n", servicePath)

	// Instructions
	fmt.Println("\n--- Installation Complete ---")
	fmt.Println("To finish the installation:")
	fmt.Println("1. Copy the 'server' binary to", config.InstallDir)
	fmt.Printf("   sudo cp server %s/\n", config.InstallDir)
	fmt.Println("2. Create the user and group if they don't exist:")
	fmt.Printf("   sudo useradd -r -s /bin/false %s\n", config.User)
	fmt.Println("3. Install the systemd service:")
	fmt.Printf("   sudo cp %s /etc/systemd/system/\n", servicePath)
	fmt.Println("4. Reload systemd and start the service:")
	fmt.Println("   sudo systemctl daemon-reload")
	fmt.Println("   sudo systemctl enable --now cedar-backend")
	fmt.Println("   sudo systemctl status cedar-backend")
}

func prompt(reader *bufio.Reader, label, def string) string {
	fmt.Printf("%s [%s]: ", label, def)
	input, _ := reader.ReadString('\n')
	input = strings.TrimSpace(input)
	if input == "" {
		return def
	}
	return input
}

func writeEnvFile(path string, env map[string]string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	for k, v := range env {
		if v != "" {
			if _, err := fmt.Fprintf(f, "%s=%s\n", k, v); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeSystemdFile(path string, config Config) error {
	t, err := template.New("systemd").Parse(systemdTemplate)
	if err != nil {
		return err
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	return t.Execute(f, config)
}
