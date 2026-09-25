import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('2.25.222.15', username='root', password='Matheo@01112', timeout=15)
cmds = [
    'pm2 status',
    'pm2 logs 8token --lines 40 --nostream 2>&1',
    'cat /etc/nginx/sites-enabled/* 2>/dev/null | head -80',
    'curl -s http://localhost:3000/api/user/ip-info -H "Authorization: Bearer test" 2>&1',
    'curl -s http://localhost:3000/api/user/current-ip -H "Authorization: Bearer test" 2>&1',
    'ls -la /root/8token/public/dashboard.html 2>/dev/null || ls -la /var/www/8token/public/dashboard.html 2>/dev/null || find / -name dashboard.html -path "*/8token/*" 2>/dev/null | head -5',
]
for cmd in cmds:
    print(f'=== {cmd[:70]} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode('utf-8', errors='replace')[:3000]
    print(out)
    err = stderr.read().decode('utf-8', errors='replace')[:500]
    if err.strip():
        print('STDERR:', err)
    print()
ssh.close()
print('Done.')