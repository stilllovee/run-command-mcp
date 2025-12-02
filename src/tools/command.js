const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

/**
 * Command execution functionality with async streaming support
 */
class CommandRunner {
  constructor() {
    // Store running and completed processes
    this.processes = new Map();
  }

  /**
   * Start a command asynchronously (non-blocking)
   * Returns a process_id to check status/output later
   * @param {string} command - Full command string to execute (e.g., "npm install", "node server.js")
   * @param {number} timeout - Timeout in milliseconds (0 = no timeout)
   */
  async startCommand(command, timeout = 0) {
    const processId = uuidv4();
    console.log('[MCP Server] Starting async command:', processId, command);

    const processInfo = {
      id: processId,
      command: command,
      status: 'running',
      stdout: '',
      stderr: '',
      exit_code: null,
      error: null,
      started_at: new Date().toISOString(),
      finished_at: null,
      timed_out: false
    };

    this.processes.set(processId, processInfo);

    const child = spawn(command, [], { shell: true });
    processInfo.pid = child.pid;

    // Set timeout if specified
    let timeoutId = null;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        processInfo.timed_out = true;
        processInfo.status = 'timed_out';
        child.kill('SIGTERM');
      }, timeout);
    }

    child.stdout.on('data', (data) => {
      processInfo.stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      processInfo.stderr += data.toString();
    });

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      processInfo.exit_code = code;
      processInfo.finished_at = new Date().toISOString();
      if (processInfo.status === 'running') {
        processInfo.status = code === 0 ? 'completed' : 'failed';
      }
    });

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      processInfo.error = error.message;
      processInfo.status = 'error';
      processInfo.finished_at = new Date().toISOString();
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            process_id: processId,
            pid: child.pid,
            command: command,
            status: 'running',
            message: 'Command started. Use get_output with this process_id to check status and logs.'
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Get the current output and status of a running/completed process
   */
  async getOutput(processId, tail = 0) {
    console.log('[MCP Server] Getting output for process:', processId);

    const processInfo = this.processes.get(processId);

    if (!processInfo) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Process not found',
              process_id: processId
            }, null, 2),
          },
        ],
      };
    }

    let stdout = processInfo.stdout;
    let stderr = processInfo.stderr;

    // If tail is specified, only return last N lines
    if (tail > 0) {
      const stdoutLines = stdout.split('\n');
      const stderrLines = stderr.split('\n');
      stdout = stdoutLines.slice(-tail).join('\n');
      stderr = stderrLines.slice(-tail).join('\n');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            process_id: processId,
            pid: processInfo.pid,
            command: processInfo.command,
            status: processInfo.status,
            exit_code: processInfo.exit_code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: processInfo.error,
            started_at: processInfo.started_at,
            finished_at: processInfo.finished_at,
            timed_out: processInfo.timed_out
          }, null, 2),
        },
      ],
    };
  }

  /**
   * List all tracked processes
   */
  async listProcesses(status = null) {
    console.log('[MCP Server] Listing processes, filter:', status);

    let processes = Array.from(this.processes.values()).map(p => ({
      process_id: p.id,
      pid: p.pid,
      command: p.command,
      status: p.status,
      started_at: p.started_at,
      finished_at: p.finished_at
    }));

    if (status) {
      processes = processes.filter(p => p.status === status);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            total: processes.length,
            processes: processes
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Kill a running process
   */
  async killProcess(processId) {
    console.log('[MCP Server] Killing process:', processId);

    const processInfo = this.processes.get(processId);

    if (!processInfo) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Process not found',
              process_id: processId
            }, null, 2),
          },
        ],
      };
    }

    if (processInfo.status !== 'running') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Process is not running',
              process_id: processId,
              status: processInfo.status
            }, null, 2),
          },
        ],
      };
    }

    try {
      process.kill(processInfo.pid, 'SIGTERM');
      processInfo.status = 'killed';
      processInfo.finished_at = new Date().toISOString();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              process_id: processId,
              message: 'Process killed'
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              process_id: processId
            }, null, 2),
          },
        ],
      };
    }
  }

  /**
   * Clear completed/failed processes from memory
   */
  async clearProcesses(processId = null) {
    console.log('[MCP Server] Clearing processes:', processId || 'all finished');

    if (processId) {
      const processInfo = this.processes.get(processId);
      if (!processInfo) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Process not found',
                process_id: processId
              }, null, 2),
            },
          ],
        };
      }
      this.processes.delete(processId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Process cleared',
              process_id: processId
            }, null, 2),
          },
        ],
      };
    }

    // Clear all non-running processes
    let cleared = 0;
    for (const [id, info] of this.processes.entries()) {
      if (info.status !== 'running') {
        this.processes.delete(id);
        cleared++;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Cleared ${cleared} finished processes`
          }, null, 2),
        },
      ],
    };
  }

  /**
   * Run a command synchronously (blocking)
   * @param {string} command - Full command string to execute (e.g., "npm install", "echo hello world")
   * @param {number} timeout - Timeout in milliseconds (default: 30000)
   */
  async runCommand(command, timeout = 30000) {
    console.log('[MCP Server] Running command (sync):', command);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(command, [], { shell: true });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: !timedOut && code === 0,
                exit_code: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timed_out: timedOut,
                command: command
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                exit_code: null,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                error: error.message,
                command: command
              }, null, 2),
            },
          ],
        });
      });
    });
  }
}

module.exports = { CommandRunner };
