'use strict';

const http = require('http');

// ── Configuration 
const TARGET_URL = 'http://localhost:8080';
const TOTAL_REQS = parseInt(process.argv[2], 10) || 1000;
const CONCURRENCY = parseInt(process.argv[3], 10) || 50;   // in-flight at once

// ── Single Request 
function sendRequest(index) {
    return new Promise((resolve) => {
        const req = http.get(TARGET_URL, (res) => {
            let raw = '';

            res.on('data', (chunk) => { raw += chunk; });

            res.on('end', () => {
                try {
                    const body = JSON.parse(raw);
                    resolve({ ok: true, server_id: body.server_id, index });
                } catch {
                    resolve({ ok: false, error: 'JSON parse error', index });
                }
            });
        });

        req.on('error', (err) => {
            resolve({ ok: false, error: err.message, index });
        });

        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ ok: false, error: 'timeout', index });
        });
    });
}

// ── Concurrency Pool 
// Runs `tasks` (array of zero-arg async fns) with at most `limit` in flight.
async function poolAll(tasks, limit) {
    const results = [];
    let taskIndex = 0;

    async function worker() {
        while (taskIndex < tasks.length) {
            const i = taskIndex++;
            results[i] = await tasks[i]();
        }
    }

    // Spin up `limit` workers and wait for all of them to drain the queue
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
}

// ── Progress Bar 
function renderProgress(done, total) {
    const pct = done / total;
    const width = 40;
    const filled = Math.round(pct * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    process.stdout.write(`\r  [${bar}] ${done}/${total}`);
}

// ── Main 
async function main() {
    console.log('┌─────────────────────────────────────────┐');
    console.log('│        Node.js Traffic Simulator         │');
    console.log('└─────────────────────────────────────────┘');
    console.log(`  Target      : ${TARGET_URL}`);
    console.log(`  Requests    : ${TOTAL_REQS.toLocaleString()}`);
    console.log(`  Concurrency : ${CONCURRENCY}`);
    console.log('');

    let completed = 0;

    // Build task list — each task is a fn returning a Promise
    const tasks = Array.from({ length: TOTAL_REQS }, (_, i) => async () => {
        const result = await sendRequest(i);
        completed++;
        if (completed % 10 === 0 || completed === TOTAL_REQS) {
            renderProgress(completed, TOTAL_REQS);
        }
        return result;
    });

    console.log('  Sending requests…');
    const startTime = Date.now();
    const results = await poolAll(tasks, CONCURRENCY);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    process.stdout.write('\n\n'); // clear progress line

    // ── Tally Results 
    const counts = {};   // { "server-1": N, … }
    let successes = 0;
    let failures = 0;
    const errors = {};   // { "timeout": N, … }

    for (const r of results) {
        if (r.ok) {
            successes++;
            counts[r.server_id] = (counts[r.server_id] ?? 0) + 1;
        } else {
            failures++;
            errors[r.error] = (errors[r.error] ?? 0) + 1;
        }
    }

    // ── Summary Report 
    console.log('┌─────────────────────────────────────────┐');
    console.log('│         Traffic Simulation Results       │');
    console.log('└─────────────────────────────────────────┘');
    console.log('');

    // Per-server breakdown (sorted)
    const sortedServers = Object.keys(counts).sort();
    const maxCount = Math.max(...Object.values(counts), 1);
    const barWidth = 20;

    sortedServers.forEach((id) => {
        const n = counts[id];
        const pct = ((n / TOTAL_REQS) * 100).toFixed(1);
        const fill = Math.round((n / maxCount) * barWidth);
        const bar = '▓'.repeat(fill) + '░'.repeat(barWidth - fill);
        console.log(`  ${id.padEnd(12)} [${bar}]  ${String(n).padStart(5)} reqs  (${pct}%)`);
    });

    console.log('');
    console.log('  ── Summary ──────────────────────────────');
    console.log(`  Total requests  : ${TOTAL_REQS.toLocaleString()}`);
    console.log(`  Successful      : ${successes.toLocaleString()}`);
    console.log(`  Failed          : ${failures.toLocaleString()}`);
    console.log(`  Elapsed time    : ${elapsed}s`);
    console.log(`  Throughput      : ${(successes / parseFloat(elapsed)).toFixed(1)} req/s`);

    if (failures > 0) {
        console.log('');
        console.log('  ── Errors ───────────────────────────────');
        Object.entries(errors).forEach(([msg, n]) => {
            console.log(`  ${msg.padEnd(22)}: ${n}`);
        });
    }

    console.log('');
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});