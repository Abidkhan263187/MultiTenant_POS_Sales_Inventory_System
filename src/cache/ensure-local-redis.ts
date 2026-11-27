import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import net from 'net';

export async function ensureLocalRedis(): Promise<void> {
  const target = localRedisTarget(process.env.REDIS_URL);
  if (!target) {
    return;
  }
  if (await canConnect(target.host, target.port)) {
    return;
  }

  const command = findRedisServer();
  if (!command) {
    console.warn('Redis is not running and redis-server was not found. Catalog reads will use PostgreSQL.');
    return;
  }

  const child = spawn(command, ['--port', String(target.port), '--bind', target.host], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', (error) => {
    console.warn(`Redis did not start: ${error.message}. Catalog reads will use PostgreSQL.`);
  });

  const started = await waitForPort(target.host, target.port, 8000);
  if (!started) {
    console.warn('Redis did not accept connections in time. Catalog reads will use PostgreSQL.');
  }
}

function localRedisTarget(raw: string | undefined): { host: string; port: number } | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      return null;
    }
    return { host: host === 'localhost' ? '127.0.0.1' : host, port: Number(url.port || 6379) };
  } catch {
    return null;
  }
}

function findRedisServer(): string | null {
  const configured = process.env.REDIS_SERVER?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  try {
    const command = process.platform === 'win32' ? 'where redis-server' : 'which redis-server';
    const found = spawnSync(command, { shell: true, encoding: 'utf8' }).stdout
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && existsSync(line));
    return found ?? null;
  } catch {
    return null;
  }
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(300, () => done(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
