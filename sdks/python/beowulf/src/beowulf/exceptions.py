class BeowulfError(Exception):
    """Base exception for Beowulf SDK errors."""


class BeowulfConfigurationError(BeowulfError):
    """Raised when SDK configuration is invalid or incomplete."""


class BeowulfAPIError(BeowulfError):
    """Raised when a backend request fails."""

    def __init__(self, message: str, status_code: int | None = None, response_body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body
