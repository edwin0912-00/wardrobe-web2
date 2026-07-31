const MARKER = '<!-- wardrobe-board:v1 -->';

export function splitPatterns(value = '') {
  return String(value).split(',').map((part) => part.trim()).filter(Boolean);
}

function recordFromComment(comment) {
  const body = String(comment?.body || '');
  if (!body.includes(MARKER)) return null;
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  const action = String(fields.ACTION || '').toUpperCase();
  const agent = String(fields.AGENT || '').toLowerCase();
  if (!agent || !['CLAIM', 'RELEASE', 'ABANDON'].includes(action)) return null;
  return {
    action,
    agent,
    lane: fields.LANE || '',
    files: splitPatterns(fields.FILES),
    intersects: fields.INTERSECTS || '',
    base: fields.BASE || '',
    sha: fields.SHA || '',
    result: fields.RESULT || '',
    createdAt: comment.createdAt || '',
    url: comment.url || ''
  };
}

export function activeClaims(payload) {
  const active = new Map();
  for (const comment of payload?.comments || []) {
    const record = recordFromComment(comment);
    if (!record) continue;
    if (record.action === 'CLAIM') active.set(record.agent, record);
    else active.delete(record.agent);
  }
  return active;
}

function descriptor(pattern) {
  if (pattern === '*') return { all: true, prefix: '' };
  if (pattern.endsWith('/*')) return { all: false, prefix: pattern.slice(0, -1) };
  if (pattern.endsWith('/')) return { all: false, prefix: pattern };
  return { all: false, exact: pattern };
}

export function patternMatches(pattern, file) {
  const item = descriptor(pattern);
  if (item.all) return true;
  if (item.exact) return item.exact === file;
  return file.startsWith(item.prefix);
}

export function patternsOverlap(left, right) {
  const a = descriptor(left);
  const b = descriptor(right);
  if (a.all || b.all) return true;
  if (a.exact && b.exact) return a.exact === b.exact;
  if (a.exact) return a.exact.startsWith(b.prefix);
  if (b.exact) return b.exact.startsWith(a.prefix);
  return a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix);
}

export function proposalConflicts(payload, agent, proposed) {
  const claims = activeClaims(payload);
  const conflicts = [];
  for (const [otherAgent, claim] of claims) {
    if (otherAgent === agent) continue;
    const overlaps = proposed.filter((candidate) =>
      claim.files.some((held) => patternsOverlap(candidate, held))
    );
    if (overlaps.length) conflicts.push({ agent: otherAgent, lane: claim.lane, overlaps });
  }
  return conflicts;
}

export function validateCommit(payload, agent, stagedFiles) {
  const claims = activeClaims(payload);
  const own = claims.get(agent);
  const errors = [];
  if (!own) {
    errors.push(`agent ${agent} has no active CLAIM`);
    return { own: null, conflicts: [], errors };
  }

  const outside = stagedFiles.filter((file) =>
    !own.files.some((pattern) => patternMatches(pattern, file))
  );
  if (outside.length) errors.push(`staged files outside claim: ${outside.join(', ')}`);

  const conflicts = [];
  for (const [otherAgent, claim] of claims) {
    if (otherAgent === agent) continue;
    const overlaps = stagedFiles.filter((file) =>
      claim.files.some((pattern) => patternMatches(pattern, file))
    );
    if (overlaps.length) {
      conflicts.push({ agent: otherAgent, lane: claim.lane, overlaps });
      errors.push(`overlap with ${otherAgent}/${claim.lane}: ${overlaps.join(', ')}`);
    }
  }
  return { own, conflicts, errors };
}

export function summary(payload) {
  const claims = [...activeClaims(payload).values()];
  if (!claims.length) return 'ACTIVE CLAIMS: none';
  return ['ACTIVE CLAIMS:'].concat(claims.map((claim) =>
    `- ${claim.agent} | ${claim.lane} | ${claim.files.join(', ')} | intersects: ${claim.intersects || 'none stated'}`
  )).join('\n');
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text || '{}');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payload = await readStdin();
  const command = process.argv[2];
  if (command === 'summary') {
    console.log(summary(payload));
  } else if (command === 'proposal') {
    const agent = String(process.env.WARDROBE_AGENT || '').toLowerCase();
    const proposed = splitPatterns(process.env.WARDROBE_FILES || '');
    const conflicts = proposalConflicts(payload, agent, proposed);
    console.log(summary(payload));
    if (conflicts.length) {
      for (const conflict of conflicts) {
        console.error(`claim overlaps ${conflict.agent}/${conflict.lane}: ${conflict.overlaps.join(', ')}`);
      }
      process.exitCode = 2;
    }
  } else if (command === 'check') {
    const agent = String(process.env.WARDROBE_AGENT || '').toLowerCase();
    const staged = String(process.env.WARDROBE_STAGED || '').split(/\r?\n/).filter(Boolean);
    const result = validateCommit(payload, agent, staged);
    console.log(summary(payload));
    if (result.errors.length) {
      for (const error of result.errors) console.error(`board check failed: ${error}`);
      process.exitCode = 3;
    } else {
      console.log(`BOARD OK: ${agent}/${result.own.lane}; staged ${staged.length} file(s)`);
    }
  } else {
    console.error('usage: collab-board-state.mjs summary|proposal|check');
    process.exitCode = 64;
  }
}
