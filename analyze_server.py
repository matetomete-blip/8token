import sys

with open('/workspace/LP-4TOKEN/server.js', 'r') as f:
    lines = f.readlines()

keywords = ['webhook', 'coupon', 'kirvano', '/api/keys', '/api/notifications', '/api/user', 'authMiddleware', 'adminMiddleware', 'validateKirvano']

for i, line in enumerate(lines):
    for kw in keywords:
        if kw.lower() in line.lower():
            start = max(0, i - 5)
            end = min(len(lines), i + 50)
            print(f"\n=== MATCH: {kw} at line {i+1} ===")
            print("".join(lines[start:end]))
            print("="*50)
            break