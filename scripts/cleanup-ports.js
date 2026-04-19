const { execSync } = require("child_process");
const os = require("os");

const ports = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0);

if (ports.length === 0) {
  process.exit(0);
}

function parseWindowsCsvRow(row) {
  return row
    .split('","')
    .map((entry) => entry.replace(/^"|"$/g, "").trim());
}

function getWindowsListeners() {
  try {
    const output = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const listeners = [];

    output.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("TCP")) return;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) return;

      const localAddress = parts[1];
      const state = parts[3];
      const pid = Number(parts[4]);
      const portMatch = localAddress.match(/:(\d+)$/);

      if (state !== "LISTENING" || !portMatch || !Number.isInteger(pid)) return;

      listeners.push({ port: Number(portMatch[1]), pid });
    });

    return listeners;
  } catch (error) {
    return [];
  }
}

function getPidsForPort(port) {
  if (os.platform() === "win32") {
    return getWindowsListeners()
      .filter((listener) => listener.port === port)
      .map((listener) => listener.pid);
  }

  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: "utf8",
    });

    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid));
  } catch (error) {
    return [];
  }
}

function getProcessName(pid) {
  if (!Number.isInteger(pid)) return null;

  if (os.platform() === "win32") {
    try {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: "utf8",
      }).trim();

      if (!output || output.startsWith("INFO:")) {
        return null;
      }

      const [processName] = parseWindowsCsvRow(output);
      return processName || null;
    } catch (error) {
      return null;
    }
  }

  try {
    return execSync(`ps -p ${pid} -o comm=`, { encoding: "utf8" }).trim();
  } catch (error) {
    return null;
  }
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid === process.pid) {
    return false;
  }

  if (os.platform() === "win32") {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      return true;
    } catch (error) {
      return false;
    }
  }

  try {
    execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
}

const blockedPorts = [];
const killed = [];
const visited = new Set();

ports.forEach((port) => {
  const pids = getPidsForPort(port);

  pids.forEach((pid) => {
    if (visited.has(pid)) return;
    visited.add(pid);

    const processName = (getProcessName(pid) || "").toLowerCase();

    if (processName.includes("node")) {
      if (killPid(pid)) {
        killed.push({ port, pid });
      } else {
        blockedPorts.push({ port, pid, processName: processName || "unknown" });
      }
      return;
    }

    blockedPorts.push({ port, pid, processName: processName || "unknown" });
  });
});

if (killed.length > 0) {
  killed.forEach(({ port, pid }) => {
    console.log(`Freed port ${port} by stopping PID ${pid}.`);
  });
}

if (blockedPorts.length > 0) {
  blockedPorts.forEach(({ port, pid, processName }) => {
    console.error(
      `Port ${port} is used by PID ${pid} (${processName}). Stop it and retry.`
    );
  });
  process.exit(1);
}
