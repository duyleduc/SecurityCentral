// Package platform provides the mTLS client for communicating with the SecurityCentral Platform API.
package platform

// Client communicates with the SecurityCentral Platform API.
type Client struct {
	baseURL string
	apiKey  string
}

// New creates a new platform client.
func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
	}
}
