#!/bin/bash
# Bridge daemon control script

SERVICE_NAME="com.clawdashboard.bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"
LOG_PATH="$HOME/.openclaw/workspace/ClawDashboard/backend/logs/bridge.log"
ERROR_LOG_PATH="$HOME/.openclaw/workspace/ClawDashboard/backend/logs/bridge-error.log"

case "${1:-}" in
  start)
    echo "Starting bridge daemon..."
    launchctl bootstrap gui/$(id -u) "$PLIST_PATH" 2>&1
    echo "Done."
    ;;
  
  stop)
    echo "Stopping bridge daemon..."
    launchctl bootout gui/$(id -u)/$SERVICE_NAME 2>&1
    echo "Done."
    ;;
  
  restart)
    echo "Restarting bridge daemon..."
    launchctl bootout gui/$(id -u)/$SERVICE_NAME 2>/dev/null || true
    sleep 1
    launchctl bootstrap gui/$(id -u) "$PLIST_PATH"
    echo "Done."
    ;;
  
  status)
    echo "=== Bridge Daemon Status ==="
    if launchctl list | grep -q "$SERVICE_NAME"; then
      PID=$(launchctl list | grep "$SERVICE_NAME" | awk '{print $1}')
      STATUS=$(launchctl list | grep "$SERVICE_NAME" | awk '{print $2}')
      echo "Status: Running (PID: $PID, Exit: $STATUS)"
    else
      echo "Status: Not running"
    fi
    echo ""
    echo "=== Recent Logs ==="
    tail -10 "$LOG_PATH" 2>/dev/null || echo "No logs found"
    ;;
  
  logs)
    echo "=== Bridge Logs (live) ==="
    tail -f "$LOG_PATH"
    ;;
  
  errors)
    echo "=== Bridge Error Logs ==="
    tail -20 "$ERROR_LOG_PATH" 2>/dev/null || echo "No error logs"
    ;;
  
  install)
    echo "Installing bridge daemon..."
    cp "$(dirname "$0")/com.clawdashboard.bridge.plist" "$PLIST_PATH"
    launchctl bootstrap gui/$(id -u) "$PLIST_PATH"
    echo "Done. Bridge daemon installed and started."
    ;;
  
  uninstall)
    echo "Uninstalling bridge daemon..."
    launchctl bootout gui/$(id -u)/$SERVICE_NAME 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "Done. Bridge daemon uninstalled."
    ;;
  
  *)
    echo "Bridge Daemon Control"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|errors|install|uninstall}"
    echo ""
    echo "Commands:"
    echo "  start      - Start the bridge daemon"
    echo "  stop       - Stop the bridge daemon"
    echo "  restart    - Restart the bridge daemon"
    echo "  status     - Show daemon status and recent logs"
    echo "  logs       - Tail live logs"
    echo "  errors     - Show error logs"
    echo "  install    - Install and start the daemon"
    echo "  uninstall  - Stop and remove the daemon"
    exit 1
    ;;
esac
