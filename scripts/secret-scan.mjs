import { execFileSync } from 'node:child_process';

// Patterns that look like sensitive keys
const patterns = [
  { regex: /AIza[A-Za-z0-9_-]{35}/g, name: 'Google API key' },
  { regex: /sk-[A-Za-z0-9]{20,}/g, name: 'OpenAI API key' },
  { regex: /ksk_[A-Za-z0-9_-]{20,}/g, name: 'Kiro secret key' },
  { regex: /atsk[A-Za-z0-9_-]{20,}/g, name: 'Africa\'s Talking API key' },
  { regex: /postgres:\/\/[^:]+:[^@]+@[^\s/]+/g, name: 'PostgreSQL URL with password' },
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g, name: 'Private key' },
];

const filesToCheck = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let foundIssues = false;

for (const file of filesToCheck) {
  try {
    const content = execFileSync('git', ['show', ':' + file], { encoding: 'utf8' });
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex, name } of patterns) {
        const match = line.match(regex);
        if (match) {
          if (!foundIssues) {
            console.error('Secrets found in staged files:');
          }
          foundIssues = true;
          console.error(`${file}:${i + 1}: ${name}`);
        }
      }
    }
  } catch (err) {
    // Skip files that can't be read (e.g., binary files, deleted files already filtered)
  }
}

if (foundIssues) {
  process.exit(1);
}