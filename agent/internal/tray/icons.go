package tray

import (
	_ "embed"
)

// Icon states for the system tray
// Icons should be 16x16 or 32x32 PNG/ICO files
// These are embedded at compile time

// Default icons are simple colored squares
// Replace these with actual icon files for production

//go:embed icons/connected.ico
var iconConnected []byte

//go:embed icons/disconnected.ico
var iconDisconnected []byte

//go:embed icons/error.ico
var iconError []byte

//go:embed icons/stopped.ico
var iconStopped []byte

// IconState represents the current icon state
type IconState int

const (
	IconStateConnected    IconState = iota // Green - connected and running
	IconStateDisconnected                  // Yellow - running but disconnected
	IconStateError                         // Red - error state
	IconStateStopped                       // Gray - agent not running
)

// GetIcon returns the icon bytes for a given state
func GetIcon(state IconState) []byte {
	switch state {
	case IconStateConnected:
		return iconConnected
	case IconStateDisconnected:
		return iconDisconnected
	case IconStateError:
		return iconError
	case IconStateStopped:
		return iconStopped
	default:
		return iconStopped
	}
}
