#!/usr/bin/env node

import fs from 'fs';
import https from 'https';

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node index.js <domain> [csv_file] [days_until_expiry]');
  console.error('Example: node index.js example.com dnspod_export.txt 30');
  process.exit(1);
}

const domain = args[0];
const csvFile = args[1];
const daysUntilExpiry = parseInt(args[2] || '30', 10);
const TIMEOUT = 3000;
const MAX_CONCURRENT = 5;

async function getCertificateExpiry(host, serverName = null) {
  return new Promise((resolve) => {
    let resolved = false;

    const options = {
      host,
      port: 443,
      method: 'HEAD',
      timeout: TIMEOUT,
      rejectUnauthorized: false,
    };

    // Only set servername if it's provided and not an IP address
    if (serverName && !/^\d+\.\d+\.\d+\.\d+$/.test(serverName)) {
      options.servername = serverName;
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, TIMEOUT + 500);

    try {
      const req = https.request(options, (res) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          const cert = res.socket.getPeerCertificate();
          res.socket.destroy();
          if (cert && cert.valid_to) {
            const expiryDate = new Date(cert.valid_to);
            resolve(expiryDate);
          } else {
            resolve(null);
          }
        }
      });

      req.on('error', () => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });

      req.on('timeout', () => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          req.destroy();
          resolve(null);
        }
      });

      req.end();
    } catch {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }
  });
}

function getStatusInfo(expiryDate, daysThreshold) {
  if (!expiryDate) {
    return { status: '无法访问', daysLeft: null, expiryStr: 'N/A' };
  }

  const now = new Date();
  const daysLeft = (expiryDate - now) / (1000 * 60 * 60 * 24);

  let status;
  if (daysLeft < 0) {
    status = '已过期';
  } else if (daysLeft < daysThreshold) {
    status = '即将过期';
  } else {
    status = '正常';
  }

  return {
    status,
    daysLeft: Math.round(daysLeft),
    expiryStr: expiryDate.toISOString().split('T')[0],
  };
}

// Extract hostname from domain
function extractHostname(target) {
  const cleaned = target.replace(/\.$/, '');
  const parts = cleaned.split('.');
  if (parts.length === 0) return null;
  return parts[0];
}

// Resolve CNAME chain to find A records
function resolveCnameChain(hostname, records, visited = new Set()) {
  // Prevent infinite loops
  if (visited.has(hostname)) {
    return { type: 'external', value: hostname };
  }

  visited.add(hostname);

  if (!records[hostname]) {
    return { type: 'external', value: hostname };
  }

  const data = records[hostname];

  // If there are A records, return them
  if (data.A.length > 0) {
    return { type: 'A', values: data.A };
  }

  // If there are CNAME records, follow the chain
  if (data.CNAME.length > 0) {
    const cnameTarget = data.CNAME[0]; // Usually only one CNAME per hostname
    const cnameHostname = extractHostname(cnameTarget);

    if (!cnameHostname) {
      // External domain
      return { type: 'external', value: cnameTarget.replace(/\.$/, '') };
    }

    // Check if it's in the same domain
    if (records[cnameHostname]) {
      return resolveCnameChain(cnameHostname, records, visited);
    } else {
      // External domain
      return { type: 'external', value: cnameTarget.replace(/\.$/, '') };
    }
  }

  return { type: 'external', value: hostname };
}

async function checkRecords() {
  // Output header
  console.log('hostname,type,ip,status,expiry_date');

  if (!csvFile || !fs.existsSync(csvFile)) {
    // Test the main domain if no CSV file provided
    const expiryDate = await getCertificateExpiry(domain);
    const info = getStatusInfo(expiryDate, daysUntilExpiry);
    console.log(`${domain},main,,${info.status},${info.expiryStr}`);
    return;
  }

  const content = fs.readFileSync(csvFile, 'utf-8');
  const lines = content.split('\n').slice(1); // Skip header

  // Parse all records first
  const records = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const hostname = parts[0];
    const recordType = parts[1];
    const recordValue = parts[3];

    if (!records[hostname]) {
      records[hostname] = { A: [], CNAME: [] };
    }

    if (recordType === 'A' || recordType === 'CNAME') {
      records[hostname][recordType].push(recordValue);
    }
  }

  const pendingTasks = [];

  // Process A records
  for (const [hostname, data] of Object.entries(records)) {
    for (const ip of data.A) {
      pendingTasks.push(async () => {
        const fullHost = hostname === '@' ? domain : `${hostname}.${domain}`;
        const expiryDate = await getCertificateExpiry(ip, fullHost);
        const info = getStatusInfo(expiryDate, daysUntilExpiry);
        console.log(`${hostname},A,${ip},${info.status},${info.expiryStr}`);
      });
    }
  }

  // Process CNAME records
  for (const [hostname, data] of Object.entries(records)) {
    for (const cnameTarget of data.CNAME) {
      pendingTasks.push(async () => {
        const cnameHostname = extractHostname(cnameTarget);
        const resolution = resolveCnameChain(cnameHostname || hostname, records);

        const fullHost = hostname === '@' ? domain : `${hostname}.${domain}`;

        if (resolution.type === 'A') {
          // Found A records in the chain
          for (const ip of resolution.values) {
            const expiryDate = await getCertificateExpiry(ip, fullHost);
            const info = getStatusInfo(expiryDate, daysUntilExpiry);
            console.log(`${hostname},CNAME,${ip},${info.status},${info.expiryStr}`);
          }
        } else {
          // External domain or no resolution - use the original CNAME target
          const targetDomain = cnameTarget.replace(/\.$/, '');
          const expiryDate = await getCertificateExpiry(targetDomain, fullHost);
          const info = getStatusInfo(expiryDate, daysUntilExpiry);
          console.log(`${hostname},CNAME,${targetDomain},${info.status},${info.expiryStr}`);
        }
      });
    }
  }

  // Execute tasks with concurrency control
  const executing = [];
  for (const task of pendingTasks) {
    const promise = task().finally(() => {
      executing.splice(executing.indexOf(promise), 1);
    });

    executing.push(promise);

    if (executing.length >= MAX_CONCURRENT) {
      await Promise.race(executing);
    }
  }

  // Wait for remaining tasks
  await Promise.all(executing);
}

checkRecords().catch(console.error);
