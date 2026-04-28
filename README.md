# android-dev-mcp-server

An [MCP](https://modelcontextprotocol.io) server that exposes Android development workflows over ADB: device discovery, screen interaction, logcat/crash diagnostics, screenshots, screen recording, and React Native helpers.

Use it to drive a connected Android device or emulator from any MCP-compatible client (Claude Code, Claude Desktop, etc.).

## Requirements

- Node.js `>=20`
- [Android platform tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) on your `PATH`
- For emulator tools: `emulator` on `PATH` or `ANDROID_HOME` / `ANDROID_SDK_ROOT` set
- A connected device (USB or TCP/IP) or running emulator

## Install / Run

Run directly with `npx` (no install):

```bash
npx -y android-dev-mcp-server
```

Or install globally:

```bash
npm install -g android-dev-mcp-server
android-dev-mcp-server
```

The server speaks MCP over stdio.

## Client configuration

### Claude Code

```bash
claude mcp add android-dev -- npx -y android-dev-mcp-server
```

### Claude Desktop / generic MCP client

Add to your MCP servers config:

```json
{
  "mcpServers": {
    "android-dev": {
      "command": "npx",
      "args": ["-y", "android-dev-mcp-server"]
    }
  }
}
```

## Tools

### Device management
- `device_list` — list connected devices and their state
- `device_connect` — connect to a device over TCP/IP
- `device_disconnect` — disconnect a TCP/IP device
- `device_enable_tcpip` — enable TCP/IP debugging on a USB device
- `adb_restart` — restart the adb server
- `emulator_list_avds` — list available Android Virtual Devices
- `emulator_boot` — boot an AVD

### App lifecycle
- `app_install` — install an APK
- `app_launch` — launch an installed app by package name

### Screen interaction
- `screen_capture` — take a screenshot
- `screen_record_start` / `screen_record_stop` — record the screen
- `screen_ui_dump` — dump the current UI hierarchy
- `screen_describe_all` — describe all visible UI elements
- `screen_describe_point` — describe the UI element at given coordinates
- `input_tap` — tap at coordinates
- `input_swipe` — swipe between coordinates
- `input_text` — type text
- `input_system_action` — send a system action (back, home, etc.)

### Logs & diagnostics
- `log_logcat` — capture logcat output (with filtering)
- `log_crash_dump` — pull recent crash dumps
- `log_crash_dump_for_app` — pull crash dumps scoped to a package
- `log_anr_traces` — pull ANR (Application Not Responding) traces
- `bugreport_capture` — capture a full Android bug report

### React Native
- `rn_open_dev_menu` — open the React Native dev menu
- `rn_reverse_port` — set up `adb reverse` for the Metro bundler

## Development

```bash
git clone https://github.com/kingbin/android-dev-mcp-server.git
cd android-dev-mcp-server
npm install
npm run build
npm start
```

Inspect with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## License

[MIT](./LICENSE) © Chris Blazek
