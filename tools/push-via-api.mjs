// 当 github.com:443 不通、但 api.github.com 可用时，用 Git Data API 推送本地 HEAD
// 用法：node tools/push-via-api.mjs [--dry]
import { execFileSync } from 'node:child_process';

const OWNER = 'Neutron-Fair';
const REPO = 'Margin';
const BRANCH = 'main';
const dry = process.argv.includes('--dry');

const git = (...args) => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });

// token 走 git credential（与其它脚本一致，不落盘）
const raw = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  maxBuffer: 1024 * 1024,
}).toString();
const token = (raw.split('\n').find((l) => l.startsWith('password=')) || '').replace('password=', '').trim();
if (!token) throw new Error('no credential');

const api = async (method, path, body) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'margin-release',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

const localHead = git('rev-parse', 'HEAD').toString().trim();
const localSubject = git('log', '-1', '--format=%s').toString().trim();

// 远端当前 head
const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const remoteHead = ref.object.sha;

if (remoteHead === localHead) {
  console.log('already up to date:', localHead);
  process.exit(0);
}

// 远端是否已有本地 HEAD（可能之前推过一半）
try {
  await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${localHead}`);
  console.log('remote already has', localHead, '- moving ref only');
  if (!dry) await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: localHead, force: false });
  console.log('DONE (ref moved)');
  process.exit(0);
} catch {
  /* 远端没有该 commit，继续按文件推 */
}

// 变更文件（相对远端 head 的 diff）
const changed = git('diff', '--name-status', `${remoteHead}`, 'HEAD').toString().trim().split('\n').filter(Boolean);
console.log('remote head:', remoteHead);
console.log('local  head:', localHead, '-', localSubject);
console.log('changed files:', changed.length);

const entries = [];
for (const line of changed) {
  const [status, ...rest] = line.split('\t');
  const path = rest.join('\t');
  if (status === 'D') {
    entries.push({ path, mode: '100644', type: 'blob', sha: null }); // 删除：sha 置空在 tree API 里表示移除
    console.log('  D', path);
    continue;
  }
  const buf = git('cat-file', 'blob', `HEAD:${path}`);
  if (!dry) {
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  ', status, path, '->', blob.sha.slice(0, 7));
  } else {
    console.log('  ', status, path, `(${buf.length}B)`);
  }
}

if (dry) {
  console.log('DRY RUN - nothing pushed');
  process.exit(0);
}

const remoteCommit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${remoteHead}`);
const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: remoteCommit.tree.sha, tree: entries });
console.log('new tree:', tree.sha.slice(0, 7));

const who = { name: 'Neutron-Fair', email: '141506479+Neutron-Fair@users.noreply.github.com' };
const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: git('log', '-1', '--format=%B').toString().trim(),
  tree: tree.sha,
  parents: [remoteHead],
  author: who,
  committer: who,
});
console.log('new commit:', commit.sha.slice(0, 7));

await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log('ref updated:', BRANCH, '->', commit.sha.slice(0, 7));

// tag（若已存在则跳过）
const tagName = process.argv.find((a) => /^v\d/.test(a));
if (tagName) {
  try {
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/tags/${tagName}`, sha: commit.sha });
    console.log('tag created:', tagName, '->', commit.sha.slice(0, 7));
  } catch (e) {
    console.log('tag exists or failed:', String(e).slice(0, 120));
  }
}

console.log('DONE', commit.sha);
