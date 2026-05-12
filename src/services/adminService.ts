import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LINES = 2000;

async function getLogFiles(date?: string): Promise<string[]> {
  try {
    await fs.access(LOG_DIR);
  } catch { return []; }
  const files = await fs.readdir(LOG_DIR);
  const logFiles = files.filter(f => /^combined-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  if (date) {
    const targetFile = `combined-${date}.log`;
    return logFiles.includes(targetFile) ? [path.join(LOG_DIR, targetFile)] : [];
  }
  logFiles.sort().reverse();
  return logFiles.slice(0, 3).map(f => path.join(LOG_DIR, f));
}

export const fetchLogs = async (level?: string, search?: string, limit?: number, date?: string) => {
  const filesToRead = await getLogFiles(date);
  if (filesToRead.length === 0) return { logs: [], total: 0, returned: 0 };

  const allEntries: any[] = [];
  for (const filePath of filesToRead) {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size === 0) continue;
      const readSize = Math.min(stats.size, 1024 * 1024);
      const buffer = Buffer.alloc(readSize);
      const fd = await fs.open(filePath, 'r');
      await fd.read(buffer, 0, readSize, stats.size - readSize);
      await fd.close();
      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry && entry.timestamp && entry.level) allEntries.push(entry);
        } catch {}
      }
    } catch (err) {
      logger.error(`Failed to read log file ${filePath}`, { error: err });
    }
  }
  allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  let filtered = allEntries;
  if (level && ['info', 'warn', 'error'].includes(level)) filtered = filtered.filter(entry => entry.level === level);
  if (search) filtered = filtered.filter(entry => JSON.stringify(entry).toLowerCase().includes(search));
  const resultLogs = filtered.slice(0, Math.min(limit || MAX_LINES, MAX_LINES));
  return { logs: resultLogs, total: filtered.length, returned: resultLogs.length };
};