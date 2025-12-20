package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	instanceKeyPrefix = "cedar:instance:"
	instanceTTL       = 30 * time.Second
	heartbeatInterval = 10 * time.Second
)

// InstanceInfo contains status information about a backend instance
type InstanceInfo struct {
	InstanceID    string                  `json:"instance_id"`
	Status        string                  `json:"status"`
	Uptime        string                  `json:"uptime"`
	CedarVersion  string                  `json:"cedar_version"`
	StartedAt     time.Time               `json:"started_at"`
	LastHeartbeat time.Time               `json:"last_heartbeat"`
	Checks        map[string]HealthStatus `json:"checks"`
	Cache         *CacheStatus            `json:"cache,omitempty"`
	SSEClients    int                     `json:"sse_clients"`
	Requests      int64                   `json:"requests"`
}

// HealthStatus represents the health of a dependency
type HealthStatus struct {
	Status  string `json:"status"`
	Latency string `json:"latency,omitempty"`
	Error   string `json:"error,omitempty"`
}

// CacheStatus represents cache statistics
type CacheStatus struct {
	Enabled   bool   `json:"enabled"`
	L1Size    int    `json:"l1_size"`
	L2Enabled bool   `json:"l2_enabled"`
	HitRate   string `json:"hit_rate"`
}

// InstanceRegistry manages registration and discovery of backend instances
type InstanceRegistry struct {
	rdb             *redis.Client
	instanceID      string
	hostname        string
	ipAddress       string
	startedAt       time.Time
	cedarVersion    string
	backendInstRepo *BackendInstanceRepo // For database persistence

	mu           sync.RWMutex
	statusFunc   func() InstanceInfo
	stopCh       chan struct{}
	stopped      bool
	requestCount int64
}

// NewInstanceRegistry creates a new instance registry
func NewInstanceRegistry(rdb *redis.Client, instanceID string) *InstanceRegistry {
	version := "unknown"
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == "github.com/cedar-policy/cedar-go" {
				version = dep.Version
				break
			}
		}
	}

	// Get hostname for database registration
	hostname := os.Getenv("INSTANCE_HOSTNAME")
	if hostname == "" {
		hostname, _ = os.Hostname()
	}

	// Get IP address
	ipAddress := os.Getenv("INSTANCE_IP")
	if ipAddress == "" {
		ipAddress = getLocalIP()
	}

	return &InstanceRegistry{
		rdb:          rdb,
		instanceID:   instanceID,
		hostname:     hostname,
		ipAddress:    ipAddress,
		startedAt:    time.Now(),
		cedarVersion: version,
		stopCh:       make(chan struct{}),
	}
}

// getLocalIP returns the non-loopback local IP of the host
func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, address := range addrs {
		// check the address type and if it is not a loopback the display it
		if ipnet, ok := address.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return ""
}

// SetBackendInstanceRepo sets the database repository for persistent registration
func (r *InstanceRegistry) SetBackendInstanceRepo(repo *BackendInstanceRepo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.backendInstRepo = repo
}

// GetInstanceID returns the instance ID of this registry
func (r *InstanceRegistry) GetInstanceID() string {
	return r.instanceID
}

// SetStatusFunc sets the function that provides current instance status
func (r *InstanceRegistry) SetStatusFunc(fn func() InstanceInfo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statusFunc = fn
}

// Start begins the heartbeat loop to register and update this instance
func (r *InstanceRegistry) Start(ctx context.Context) {
	if r.rdb == nil {
		log.Println("Instance registry: Redis not available, skipping registration")
		return
	}

	// Initial registration
	r.register(ctx)

	// Start heartbeat loop
	go r.heartbeatLoop(ctx)
}

// Stop stops the heartbeat loop and deregisters the instance
func (r *InstanceRegistry) Stop(ctx context.Context) {
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return
	}
	r.stopped = true
	close(r.stopCh)
	r.mu.Unlock()

	// Deregister instance
	if r.rdb != nil {
		key := instanceKeyPrefix + r.instanceID
		_ = r.rdb.Del(ctx, key).Err()
	}
}

func (r *InstanceRegistry) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			r.register(ctx)
		case <-r.stopCh:
			return
		case <-ctx.Done():
			return
		}
	}
}

func (r *InstanceRegistry) register(ctx context.Context) {
	r.mu.RLock()
	statusFunc := r.statusFunc
	backendInstRepo := r.backendInstRepo
	r.mu.RUnlock()

	info := InstanceInfo{
		InstanceID:    r.instanceID,
		Status:        "healthy",
		Uptime:        formatDuration(time.Since(r.startedAt)),
		CedarVersion:  r.cedarVersion,
		StartedAt:     r.startedAt,
		LastHeartbeat: time.Now(),
		Checks:        make(map[string]HealthStatus),
	}

	// If we have a status function, use it to get current status
	if statusFunc != nil {
		info = statusFunc()
		info.LastHeartbeat = time.Now()
	}

	// Always update request count from atomic counter
	info.Requests = r.GetRequestCount()

	// Register to Redis for real-time discovery
	data, err := json.Marshal(info)
	if err != nil {
		log.Printf("Instance registry: failed to marshal instance info: %v", err)
		return
	}

	key := instanceKeyPrefix + r.instanceID
	if err := r.rdb.Set(ctx, key, data, instanceTTL).Err(); err != nil {
		log.Printf("Instance registry: failed to register instance: %v", err)
	}

	// Also register to database for persistent tracking and approval workflow
	if backendInstRepo != nil {
		_, err := backendInstRepo.Register(ctx, BackendInstanceRegisterRequest{
			InstanceID:   r.instanceID,
			Hostname:     r.hostname,
			IPAddress:    r.ipAddress,
			CedarVersion: r.cedarVersion,
			OSInfo:       runtime.GOOS,
			Arch:         runtime.GOARCH,
		})
		if err != nil {
			log.Printf("Instance registry: failed to register to database: %v", err)
		}
	}
}

// ListInstances returns all currently registered instances
func (r *InstanceRegistry) ListInstances(ctx context.Context) ([]InstanceInfo, error) {
	if r.rdb == nil {
		// Return just this instance if Redis is not available
		r.mu.RLock()
		statusFunc := r.statusFunc
		r.mu.RUnlock()

		if statusFunc != nil {
			return []InstanceInfo{statusFunc()}, nil
		}
		return []InstanceInfo{{
			InstanceID:   r.instanceID,
			Status:       "healthy",
			Uptime:       formatDuration(time.Since(r.startedAt)),
			CedarVersion: r.cedarVersion,
			StartedAt:    r.startedAt,
		}}, nil
	}

	// Scan for all instance keys
	pattern := instanceKeyPrefix + "*"
	var keys []string
	var cursor uint64

	for {
		var err error
		var batch []string
		batch, cursor, err = r.rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, fmt.Errorf("failed to scan instance keys: %w", err)
		}
		keys = append(keys, batch...)
		if cursor == 0 {
			break
		}
	}

	if len(keys) == 0 {
		// No instances in Redis, return current instance
		r.mu.RLock()
		statusFunc := r.statusFunc
		r.mu.RUnlock()

		if statusFunc != nil {
			return []InstanceInfo{statusFunc()}, nil
		}
		return []InstanceInfo{}, nil
	}

	// Get all instance data
	values, err := r.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get instance data: %w", err)
	}

	var instances []InstanceInfo
	for _, val := range values {
		if val == nil {
			continue
		}
		str, ok := val.(string)
		if !ok {
			continue
		}

		var info InstanceInfo
		if err := json.Unmarshal([]byte(str), &info); err != nil {
			log.Printf("Instance registry: failed to unmarshal instance info: %v", err)
			continue
		}
		instances = append(instances, info)
	}

	return instances, nil
}

// IncrementRequestCount increments the request counter
func (r *InstanceRegistry) IncrementRequestCount() {
	atomic.AddInt64(&r.requestCount, 1)
}

// GetRequestCount returns the current request count
func (r *InstanceRegistry) GetRequestCount() int64 {
	return atomic.LoadInt64(&r.requestCount)
}

// formatDuration formats a duration into a human-readable string
func formatDuration(d time.Duration) string {
	if d < time.Second {
		return "just started"
	}

	var parts []string

	days := int(d.Hours() / 24)
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
		d -= time.Duration(days) * 24 * time.Hour
	}

	hours := int(d.Hours())
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
		d -= time.Duration(hours) * time.Hour
	}

	minutes := int(d.Minutes())
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
		d -= time.Duration(minutes) * time.Minute
	}

	seconds := int(d.Seconds())
	if seconds > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", seconds))
	}

	return strings.Join(parts, " ")
}
