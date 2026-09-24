import re

with open('/workspace/LP-4TOKEN/server.js', 'r') as f:
    lines = f.readlines()

targets = ['adminAuth', 'ensureIpRecord', 'admin.html', 'function admin']
with open('/workspace/LP-4TOKEN/auth_analysis.txt', 'w') as out:
    for target in targets:
        out.write(f"\n\n=== SEARCHING FOR: {target} ===\n")
        found = False
        for i, line in enumerate(lines):
            if target in line:
                found = True
                start = max(0, i-2)
                end = min(len(lines), i+15)
                out.write(f"--- Line {i+1} ---\n")
                out.write(''.join(lines[start:end]))
                out.write('\n')
        if not found:
            out.write(f"NOT FOUND: {target}\n")