// Read only the pinned legacy source used by the still-legacy API contract.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
module.exports = function legacySource(root, name) {
  if (!['mbti.js', 'plan.js'].includes(name)) throw new Error('Unsupported legacy contract source.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/legacy/manifest.json'), 'utf8'));
  if (manifest.format !== 'bic-legacy-assessment-sources' || manifest.version !== 1 || manifest.profile !== 'legacy-2026.10'
      || manifest.source_revision !== 'a10d5577c18ce48188fd74e31829d57d57fc3dd5' || !Array.isArray(manifest.files)) throw new Error('Review the pinned legacy contract manifest.');
  const entries = manifest.files.filter(item => item.file === 'js/legacy/' + name && item.source === 'js/' + name);
  if (entries.length !== 1) throw new Error('Review the pinned legacy source entry.');
  const source = fs.readFileSync(path.join(root, entries[0].file), 'utf8').replace(/\r\n/g, '\n');
  if (crypto.createHash('sha256').update(source, 'utf8').digest('hex') !== entries[0].sha256) throw new Error('Legacy source fingerprint changed; preserve and review the original contract.');
  return source;
};
