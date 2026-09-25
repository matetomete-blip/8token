const fs = require('fs');
const content = fs.readFileSync('F:\\agentes ia\\8Token\\public\\dashboard.html', 'utf8');
const lines = content.split('\n');
console.log('Total lines:', lines.length);
// Print lines around the suspected sinks
const targets = [750, 751, 752, 753, 754, 755, 770, 771, 772, 773, 774, 775, 800, 801, 802, 803, 804, 805, 960, 961, 962, 963, 964, 965, 966];
for (const t of targets) {
  if (lines[t-1]) console.log(`L${t}: ${lines[t-1]}`);
}