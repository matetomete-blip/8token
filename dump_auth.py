import os

with open('/workspace/LP-4TOKEN/server.js', 'r') as f:
    lines = f.readlines()

out = []

for i, line in enumerate(lines):
    if "app.post('/api/auth/google'" in line:
        out.append(f"=== GOOGLE OAUTH (Starts line {i+1}) ===")
        out.extend(lines[i:i+45])
        out.append("\n")
    if "ADMIN_SECRET" in line:
        out.append(f"=== ADMIN_SECRET (Line {i+1}) ===")
        out.extend(lines[max(0, i-2):i+5])
        out.append("\n")
    if "JWT_SECRET" in line and "const" in line:
        out.append(f"=== JWT_SECRET (Line {i+1}) ===")
        out.extend(lines[max(0, i-2):i+5])
        out.append("\n")
    if "ensureIpRecord" in line and ("function" in line or "=>" in line or "const" in line):
        out.append(f"=== ENSURE IP (Line {i+1}) ===")
        out.extend(lines[i:i+20])
        out.append("\n")

env_path = '/workspace/LP-4TOKEN/.env'
if os.path.exists(env_path):
    out.append("=== .env ===")
    with open(env_path, 'r') as f:
        out.append(f.read())
else:
    out.append("=== .env NOT FOUND ===")

with open('/workspace/LP-4TOKEN/auth_dump.txt', 'w') as f:
    f.write(''.join(out))

print("Done. Check auth_dump.txt")