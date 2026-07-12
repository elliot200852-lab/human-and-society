const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const OUTPUT = path.join(ROOT, 'output');
const CHECK_ONLY = process.argv.includes('--check');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function staticChecks() {
  for (const file of ['index.html', 'article.html']) {
    const html = fs.readFileSync(path.join(SITE, file), 'utf8');
    assert(/noindex/.test(html), `${file} 缺少 noindex`);
    const legacyNames = ['David ' + '素材展示', ['david', 'showcase'].join('-')];
    assert(!legacyNames.some(name => html.includes(name)), `${file} 殘留舊站名稱`);
  }
  const robots = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
  assert(/User-agent: \*[\s\S]*Disallow: \//.test(robots), 'robots.txt 未封鎖全站');
  assert(fs.existsSync(path.join(SITE, 'content', 'founding-vision.md')), '首篇文章來源不存在');
  console.log('Static checks passed.');
}

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'content') continue;
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(src, dst); else fs.copyFileSync(src, dst);
  }
}

async function pullDriveHtml() {
  const folderId = process.env.HUMAN_AND_SOCIETY_DRIVE_FOLDER_ID;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!folderId || !rawKey) {
    console.log('Drive credentials/folder not present; built the version-controlled public site only.');
    return;
  }
  const crypto = require('crypto');
  const key = JSON.parse(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');
  const tokenResponse = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  });
  assert(tokenResponse.ok, `OAuth token request failed: ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  const query = `'${folderId}' in parents and mimeType='text/html' and trashed=false`;
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.search = new URLSearchParams({ q: query, fields: 'files(id,name)', orderBy: 'name', pageSize: '1000' });
  const response = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
  assert(response.ok, `Drive list failed: ${response.status}`);
  const listing = await response.json();
  const driveDir = path.join(OUTPUT, 'files');
  fs.mkdirSync(driveDir, { recursive: true });
  for (const file of listing.files || []) {
    const safeName = path.basename(file.name);
    const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
    assert(result.ok, `Drive download failed for ${safeName}: ${result.status}`);
    let html = await result.text();
    if (!/noindex/.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, '$&\n<meta name="robots" content="noindex, nofollow, noarchive">');
    fs.writeFileSync(path.join(driveDir, safeName), html);
  }
}

async function main() {
  staticChecks();
  if (CHECK_ONLY) return;
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  copyTree(SITE, OUTPUT);
  await pullDriveHtml();
}

main().catch(error => { console.error(error); process.exit(1); });
