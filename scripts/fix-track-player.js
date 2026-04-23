const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt');
if (!fs.existsSync(file)) { console.log('RNTP not found, skipping.'); process.exit(0); }
let c = fs.readFileSync(file, 'utf8');
const a = 'Arguments.fromBundle(musicService.tracks[index].originalItem)';
const b = 'Arguments.fromBundle(musicService.tracks[index].originalItem ?: Bundle())';
if (c.includes(a)) { c = c.replace(a, b); console.log('Fix 1 applied.'); } else { console.log('Fix 1 already done.'); }
const x = '.getCurrentTrackIndex()].originalItem\n            )';
const y = '.getCurrentTrackIndex()].originalItem ?: Bundle()\n            )';
if (c.includes(x)) { c = c.replace(x, y); console.log('Fix 2 applied.'); } else { console.log('Fix 2 already done.'); }
fs.writeFileSync(file, c, 'utf8');
