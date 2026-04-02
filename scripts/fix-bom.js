const fs = require('fs');
const path = require('path');

const SEARCH_DIRS = ['node_modules', 'modules'];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith('.json')) {
      const buf = fs.readFileSync(full);
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        fs.writeFileSync(full, buf.slice(3));
        console.log('Fixed BOM:', full);
      }
    }
  }
}

for (const dir of SEARCH_DIRS) {
  walk(path.join(process.cwd(), dir));
}