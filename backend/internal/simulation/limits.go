package simulation

const (
	// DefaultSampleSize is used when request sample size is not provided.
	DefaultSampleSize = 100
	// MaxSampleSize caps synthetic or replay request volume per simulation run.
	MaxSampleSize = 5000
	// MaxCustomScenarios caps custom input payload size for simulation requests.
	MaxCustomScenarios = 5000
)
