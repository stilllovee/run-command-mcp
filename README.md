# Run Command MCP Server

A Model Context Protocol (MCP) server that provides command execution capabilities with both synchronous and asynchronous streaming support.

## Features
- **Synchronous Command Execution**: Run commands and wait for completion
- **Asynchronous Command Execution**: Start commands in background and monitor progress
- **Real-time Output Streaming**: Check command output while it's running
- **Process Management**: List, monitor, kill, and clean up processes
- **Timeout Support**: Automatically terminate long-running commands
- **Multiple Transport Modes**: 
  - **Stdio Transport**: Standard MCP communication via stdin/stdout
  - **HTTP Transport**: RESTful API with Server-Sent Events (SSE) support for real-time notifications
- **MCP Standard Compliance**: Fully compliant with MCP specifications
   
## Usage

### Stdio Transport (Default)

#### Claude Desktop
```json
{
  "mcpServers": {
    "run-command": {
      "command": "npx",
      "args": ["github:stilllovee/run-command-mcp-server"]
    }
  }
}
```

Or use locally after cloning:
```json
{
  "mcpServers": {
    "run-command": {
      "command": "node",
      "args": ["PATH_TO_YOUR_REPO/index.js"]
    }
  }
}
```

#### Github Copilot
```json
{
    "servers": {
        "run-command": {
            "type": "stdio",
            "command": "npx",
            "args": ["github:stilllovee/run-command-mcp-server"]
        },
    },
    "inputs": []
}
```

Or use locally after cloning:
```json
{
    "servers": {
        "run-command": {
            "type": "stdio",
            "command": "node",
            "args": ["PATH_TO_YOUR_REPO/index.js"]
        }
    },
    "inputs": []
}
```

### HTTP Transport (Streamable)

Start the HTTP server:

```bash
# Default port (8123)
npm run start:http

# Custom port
node http-server.js --port=3000
```

The server will be available at: `http://localhost:8123/mcp`

#### Github Copilot Configuration (HTTP)

```json
{
    "servers": {
        "run-command-http": {
            "type": "http",
            "url": "http://localhost:8123/mcp"
        }
    },
    "inputs": []
}
```

### Available Tools

#### `run_command`
Run a custom shell command synchronously and return the output (stdout, stderr, exit code). Blocks until command completes.

**Parameters:**
- `command` (required): The command to execute (e.g., "echo", "ls", "git")
- `args` (optional): Array of arguments to pass to the command
- `timeout` (optional): Timeout in milliseconds (default: 30000)

**Example:**
```json
{
  "command": "echo",
  "args": ["hello", "world"],
  "timeout": 5000
}
```

#### `start_command`
Start a command asynchronously (non-blocking). Returns a process_id to check status and output later.

**Parameters:**
- `command` (required): The command to execute
- `args` (optional): Array of arguments to pass to the command
- `timeout` (optional): Timeout in milliseconds. 0 means no timeout (default: 0)

**Example:**
```json
{
  "command": "node",
  "args": ["server.js"],
  "timeout": 0
}
```

#### `get_command_output`
Get the current output and status of a running or completed async command by process_id.

**Parameters:**
- `process_id` (required): The process ID returned by start_command
- `tail` (optional): Only return the last N lines of output (0 = all)

**Example:**
```json
{
  "process_id": "550e8400-e29b-41d4-a716-446655440000",
  "tail": 10
}
```

#### `list_processes`
List all tracked processes (running, completed, failed, etc.)

**Parameters:**
- `status` (optional): Filter by status: running, completed, failed, killed, error, timed_out

**Example:**
```json
{
  "status": "running"
}
```

#### `kill_process`
Kill a running process by process_id

**Parameters:**
- `process_id` (required): The process ID to kill

**Example:**
```json
{
  "process_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### `clear_processes`
Clear finished processes from memory. If process_id is provided, clears that specific process. Otherwise clears all non-running processes.

**Parameters:**
- `process_id` (optional): Specific process ID to clear

**Example:**
```json
{
  "process_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Usage Examples

### Example 1: Run a simple synchronous command
```
User: Run "echo hello world"
AI: Uses run_command to execute and get immediate results
```

### Example 2: Start a long-running server
```
User: Start my Node.js server
AI: Uses start_command to start server in background
AI: Uses get_command_output to check if server started successfully
```

### Example 3: Monitor build progress
```
User: Build my project and show me the progress
AI: Uses start_command to start build
AI: Periodically uses get_command_output to check build logs
AI: Reports progress to user in real-time
```

### Example 4: Run Azure Functions locally
```
User: Start my Azure Functions app
AI: Uses start_command with "func start"
AI: Monitors output with get_command_output
AI: Shows compilation progress and when functions are ready
```

## Use Cases

- **Development Servers**: Start and monitor Node.js, Python, or other development servers asynchronously
- **Build Processes**: Run and monitor long build processes (webpack, tsc, etc.)
- **Testing**: Run test suites and monitor results
- **System Administration**: Execute system commands and check results
- **Log Monitoring**: Start services and continuously check their logs
