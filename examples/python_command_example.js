/**
 * examples/python_command_example.js
 *
 * Robust example that demonstrates how to execute a Python script (or a Python
 * command) from Node.js in a safe, cross-platform and Promise-based way.
 *
 * Features:
 *  - Detects python3 / python on the system
 *  - Uses execFile to avoid shell injection and quoting problems
 *  - Allows passing arguments and environment overrides (useful for virtualenv)
 *  - Optional timeout (ms)
 *  - Programmatic API + CLI usage example
 *
 * Usage (CLI):
 *   node examples/python_command_example.js path/to/script.py arg1 arg2
 *
 * Example (programmatic):
 *   const { runPython } = require('./examples/python_command_example');
 *   runPython('path/to/script.py', ['a','b'], { timeout: 10_000 })
 *     .then(res => console.log(res.stdout))
 *     .catch(err => console.error(err));
 */

const { promisify } = require('util');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

/**
 * Try to pick a sensible Python binary name on the current system.
 * Prefer 'python3' if available; fall back to 'python'.
 *
 * @returns {string} - The python command to use
 */
async function detectPythonBinary() {
  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      // On many systems `--version` writes to stdout or stderr; we just check exit code.
      await execFileAsync(cmd, ['--version'], { timeout: 2000 });
      return cmd;
    } catch (err) {
      // ignore and try next candidate
    }
  }
  // If neither command found, throw a helpful error.
  throw new Error('No python binary found on PATH. Install Python or provide pythonPath option.');
}

/**
 * Run a python script or module in a safe manner.
 *
 * @param {string} scriptPathOrModule - Path to a Python script (file) or module (pass "-m modulename" via options)
 * @param {string[]} args - args to pass to the python invocation (argv for the script)
 * @param {Object} options - optional
 *     { string } pythonPath - override detected python binary
 *     { number } timeout - ms, default 30000
 *     { Object } env - extra env vars (merged with process.env)
 *     { boolean } module - if true, run with -m <scriptPathOrModule> instead of file path
 *
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function runPython(scriptPathOrModule, args = [], options = {}) {
  const {
    pythonPath = null,
    timeout = 30_000,
    env = {},
    module = false,
  } = options;

  const pythonBinary = pythonPath || await detectPythonBinary();

  const execArgs = [];
  if (module) {
    execArgs.push('-m', scriptPathOrModule);
  } else {
    // if it's a relative path, try to resolve it
    const resolved = path.resolve(scriptPathOrModule);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Python script not found at path: ${resolved}`);
    }
    execArgs.push(resolved);
  }

  // add the script args
  if (Array.isArray(args) && args.length > 0) {
    execArgs.push(...args.map(String));
  }

  const mergedEnv = Object.assign({}, process.env, env);

  try {
    const { stdout, stderr } = await execFileAsync(pythonBinary, execArgs, {
      env: mergedEnv,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10 MB stdout/stderr buffer
    });
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    };
  } catch (err) {
    // err may be an Error with properties: code (exit code), stdout, stderr, signal, killed
    // Normalize and rethrow a structured error so callers can handle it cleanly
    const normalized = {
      message: err.message,
      exitCode: typeof err.code === 'number' ? err.code : null,
      signal: err.signal || null,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
      timedOut: err.killed === true && err.signal === 'SIGTERM', // heuristic
    };
    const wrapper = new Error(`Python execution failed: ${normalized.message}`);
    wrapper.details = normalized;
    throw wrapper;
  }
}

/**
 * Minimal CLI wrapper so this example can be run standalone:
 * node examples/python_command_example.js path/to/script.py arg1 arg2
 */
async function mainCli() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log('Usage: node examples/python_command_example.js <script.py | module> [args...]');
    console.log('Example: node examples/python_command_example.js examples/hello.py Alice');
    console.log('To run a module: set the env RUN_AS_MODULE=1 and pass the module name as first arg.');
    process.exitCode = 1;
    return;
  }

  const runAsModule = process.env.RUN_AS_MODULE === '1' || process.env.RUN_AS_MODULE === 'true';
  const script = argv[0];
  const args = argv.slice(1);

  try {
    const result = await runPython(script, args, {
      timeout: 60_000,
      module: runAsModule,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = 0;
  } catch (e) {
    console.error('Error running python:', e.message || e);
    if (e.details) {
      console.error('Exit code:', e.details.exitCode);
      if (e.details.stdout) console.error('Stdout:', e.details.stdout);
      if (e.details.stderr) console.error('Stderr:', e.details.stderr);
    }
    process.exitCode = 2;
  }
}

// Export for other JS code to reuse
module.exports = {
  runPython,
  detectPythonBinary,
};

// If called directly, run the CLI
if (require.main === module) {
  mainCli();
}
