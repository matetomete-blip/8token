import re

# Fix admin.html - remove only coupon-specific parts
with open('/opt/8token/admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

orig_len = len(content)

# 1. Remove sidebar button for coupons (multiline)
content = re.sub(r'\s*<button class="sidebar-link"[^>]*onclick="switchTab\(.coupons.[^>]*>.*?</button>', '', content, flags=re.DOTALL)

# 2. Remove TAB: COUPONS panel - match from comment to closing divs
content = re.sub(r'\s*<!-- TAB: COUPONS -->.*?</div>\s*</div>\s*</div>', '', content, flags=re.DOTALL)

# 3. Remove switchTab handler for coupons
content = re.sub(r'\s*if \(name === .coupons.\) loadCoupons\(\);', '', content)

# 4. Remove COUPONS JS block - from comment to next section or end
content = re.sub(r'\s*// ---- COUPONS ----.*?(?=\n\s*(?:// ----|\Z))', '', content, flags=re.DOTALL)

with open('/opt/8token/admin.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'admin.html: {orig_len} -> {len(content)} chars')

# Fix public/admin.html
with open('/opt/8token/public/admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

orig_len = len(content)

# 1. Remove tab button
content = re.sub(r'\s*<button class="admin-tab-btn"[^>]*data-tab="coupons"[^>]*>Cupons</button>', '', content)

# 2. Remove TAB: COUPONS panel
content = re.sub(r'\s*<!-- TAB: COUPONS -->.*?</div>\s*</div>\s*</div>', '', content, flags=re.DOTALL)

# 3. Remove switchTab handler
content = re.sub(r'\s*if \(name === .coupons.\) loadCoupons\(\);', '', content)

# 4. Remove COUPONS JS block
content = re.sub(r'\s*// ---- COUPONS ----.*?(?=\n\s*(?:// ----|\Z))', '', content, flags=re.DOTALL)

with open('/opt/8token/public/admin.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'public/admin.html: {orig_len} -> {len(content)} chars')

# Verify
import subprocess
for f in ['/opt/8token/admin.html', '/opt/8token/public/admin.html']:
    result = subprocess.run(['grep', '-c', '-i', 'coupon\\|cupom', f], capture_output=True, text=True)
    print(f'{f}: {result.stdout.strip()} coupon refs remaining')