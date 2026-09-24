import re

with open('/workspace/LP-4TOKEN/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

print("=== ROUTES ===")
# Match app.method('path', middleware1, middleware2, handler)
route_pattern = re.compile(r'app\.(get|post|put|delete|patch)\s*\(\s*[\'"]([^\'"]+)[\'"]\s*,\s*([^)]+)\)', re.IGNORECASE)
for m in route_pattern.finditer(content):
    method = m.group(1).upper()
    path = m.group(2)
    handlers = m.group(3).strip().replace('\n', ' ')
    print(f"{method:6} {path:50} -> {handlers[:120]}")

print("\n=== MIDDLEWARE DEFINITIONS ===")
mw_pattern = re.compile(r'(?:const|let|var|function)\s+(authMiddleware|adminMiddleware|verifyToken|verifyAdmin|checkAdmin|validateKirvanoWebhook)\s*=?\s*[\s\S]{0,600}?}\s*\);?', re.IGNORECASE)
for m in mw_pattern.finditer(content):
    print(m.group(0)[:500])
    print("---")

print("\n=== WEBHOOK & COUPON HANDLERS (Context) ===")
special_pattern = re.compile(r'app\.(post|get|put)\s*\(\s*[\'"][^"\']*(?:webhook|coupon|payment|pix|kirvano)[^"\']*[\'"][\s\S]{0,1200}?}\s*\);', re.IGNORECASE)
for m in special_pattern.finditer(content):
    print(m.group(0)[:800])
    print("---")