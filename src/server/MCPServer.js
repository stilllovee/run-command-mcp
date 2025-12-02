const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, InitializeRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { randomUUID } = require('crypto');

const { CommandRunner } = require('../tools/command');

const SESSION_ID_HEADER_NAME = 'mcp-session-id';
const JSON_RPC = '2.0';

class MCPServer {
  constructor(server = null) {
    this.server = server || new Server(
      {
        name: 'run-command-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // To support multiple simultaneous connections (for HTTP mode)
    this.transports = {};

    // Initialize database and task manager
    this.commandRunner = new CommandRunner();

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'run_command',
            description: 'Run a custom shell command synchronously and return the output (stdout, stderr, exit code). Blocks until command completes.',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'The full command to execute (e.g., "echo hello world", "npm install", "git status")',
                },
                timeout: {
                  type: 'number',
                  description: 'Timeout in milliseconds (default: 30000)',
                },
              },
              required: ['command'],
            },
          },
          {
            name: 'start_command',
            description: 'Start a command asynchronously (non-blocking). Returns a process_id to check status and output later using get_command_output.',
            inputSchema: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'The full command to execute (e.g., "node server.js", "npm run dev", "func start")',
                },
                timeout: {
                  type: 'number',
                  description: 'Timeout in milliseconds. 0 means no timeout (default: 0)',
                },
              },
              required: ['command'],
            },
          },
          {
            name: 'get_command_output',
            description: 'Get the current output and status of a running or completed async command by process_id.',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'The process ID returned by start_command',
                },
                tail: {
                  type: 'number',
                  description: 'Only return the last N lines of output (optional, 0 = all)',
                },
              },
              required: ['process_id'],
            },
          },
          {
            name: 'list_processes',
            description: 'List all tracked processes (running, completed, failed, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Filter by status: running, completed, failed, killed, error, timed_out (optional)',
                },
              },
              required: [],
            },
          },
          {
            name: 'kill_process',
            description: 'Kill a running process by process_id',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'The process ID to kill',
                },
              },
              required: ['process_id'],
            },
          },
          {
            name: 'clear_processes',
            description: 'Clear finished processes from memory. If process_id is provided, clears that specific process. Otherwise clears all non-running processes.',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'Specific process ID to clear (optional)',
                },
              },
              required: [],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {

        if (name === 'run_command') {
          return await this.commandRunner.runCommand(args.command, args.timeout || 30000);
        }

        if (name === 'start_command') {
          return await this.commandRunner.startCommand(args.command, args.timeout || 0);
        }

        if (name === 'get_command_output') {
          return await this.commandRunner.getOutput(args.process_id, args.tail || 0);
        }

        if (name === 'list_processes') {
          return await this.commandRunner.listProcesses(args.status || null);
        }

        if (name === 'kill_process') {
          return await this.commandRunner.killProcess(args.process_id);
        }

        if (name === 'clear_processes') {
          return await this.commandRunner.clearProcesses(args.process_id || null);
        }
      } catch (error) {
        console.error(`[MCP Server] Error executing tool ${name}:`, error);
        throw new Error(`Tool execution failed: ${error.message}`);
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      if (this.database) {
        this.database.close();
      }
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Server] MCP Server running on stdio');
  }

  // ===== HTTP Transport Methods =====

  /**
   * Handle GET requests for SSE streams (Server-Sent Events)
   */
  async handleGetRequest(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !this.transports[sessionId]) {
      res.status(400).json(
        this.createErrorResponse('Bad Request: invalid session ID or method.')
      );
      return;
    }

    console.log(`[MCP Server] Establishing SSE stream for session ${sessionId}`);
    const transport = this.transports[sessionId];
    await transport.handleRequest(req, res);

    // Optional: Send streaming messages if needed
    // await this.streamMessages(transport);
  }

  /**
   * Handle POST requests for MCP messages
   */
  async handlePostRequest(req, res) {
    const sessionId = req.headers[SESSION_ID_HEADER_NAME];
    let transport;

    try {
      // Reuse existing transport
      if (sessionId && this.transports[sessionId]) {
        transport = this.transports[sessionId];
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Create new transport for initialize request
      if (!sessionId && this.isInitializeRequest(req.body)) {
        // Dynamically import StreamableHTTPServerTransport
        const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        await this.server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        // Session ID will only be available (if not in Stateless-Mode)
        // after handling the first request
        const newSessionId = transport.sessionId;
        if (newSessionId) {
          this.transports[newSessionId] = transport;
          console.log(`[MCP Server] New session created: ${newSessionId}`);
        }

        return;
      }

      res.status(400).json(
        this.createErrorResponse('Bad Request: invalid session ID or method.')
      );
    } catch (error) {
      console.error('[MCP Server] Error handling MCP request:', error);
      res.status(500).json(this.createErrorResponse('Internal server error.'));
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.server.close();
    if (this.database) {
      this.database.close();
    }
  }

  /**
   * Send notification through transport
   */
  async sendNotification(transport, notification) {
    const rpcNotification = {
      ...notification,
      jsonrpc: JSON_RPC,
    };
    await transport.send(rpcNotification);
  }

  /**
   * Create a JSON-RPC error response
   */
  createErrorResponse(message) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: message,
      },
      id: randomUUID(),
    };
  }

  /**
   * Check if the request body is an initialize request
   */
  isInitializeRequest(body) {
    const isInitial = (data) => {
      const result = InitializeRequestSchema.safeParse(data);
      return result.success;
    };

    if (Array.isArray(body)) {
      return body.some((request) => isInitial(request));
    }
    return isInitial(body);
  }

  /**
   * Optional: Stream messages for SSE demo
   */
  async streamMessages(transport) {
    try {
      const message = {
        method: 'notifications/message',
        params: { level: 'info', data: 'SSE Connection established' },
      };

      await this.sendNotification(transport, message);

      let messageCount = 0;
      const interval = setInterval(async () => {
        messageCount++;
        const data = `Message ${messageCount} at ${new Date().toISOString()}`;

        const notification = {
          method: 'notifications/message',
          params: { level: 'info', data: data },
        };

        try {
          await this.sendNotification(transport, notification);

          if (messageCount >= 3) {
            clearInterval(interval);
            await this.sendNotification(transport, {
              method: 'notifications/message',
              params: { level: 'info', data: 'Streaming complete!' },
            });
          }
        } catch (error) {
          console.error('[MCP Server] Error sending message:', error);
          clearInterval(interval);
        }
      }, 1000);
    } catch (error) {
      console.error('[MCP Server] Error in streamMessages:', error);
    }
  }
}

module.exports = {
  MCPServer: MCPServer,
};