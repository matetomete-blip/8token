with open('/workspace/LP-4TOKEN/server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()
print(f"Total lines: {len(lines)}")
for i, line in enumerate(lines[:600], 1):
    print(f"{i:4d} | {line.rstrip()}")