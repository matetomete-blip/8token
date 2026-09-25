import paramiko, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('2.25.222.15', username='root', password='Matheo@01112', timeout=15)

# Upload the fixed server.js
sftp = ssh.open_sftp()
local_path = r'F:\agentes ia\8Token\server.js'
remote_path = '/opt/8token/server.js'
print(f'Uploading {local_path} -> {remote_path}')
sftp.put(local_path, remote_path)
print('Upload complete.')
sftp.close()

# Also upload dashboard.html with debug logging
local_dash = r'F:\agentes ia\8Token\public\dashboard.html'
remote_dash = '/opt/8token/public/dashboard.html'
print(f'Uploading {local_dash} -> {remote_dash}')
sftp2 = ssh.open_sftp()
sftp2.put(local_dash, remote_dash)
print('Dashboard upload complete.')
sftp2.close()

# Restart PM2
cmds = [
    'cd /opt/8token && pm2 restart 8token',
    'sleep 3 && pm2 status',
    'pm2 logs 8token --lines 10 --nostream 2>&1',
    'curl -s http://localhost:3000/api/user/ip-info -H "Authorization: Bearer test" 2>&1',
    'curl -s http://localhost:3000/api/user/current-ip -H "Authorization: Bearer test" 2>&1',
]

for cmd in cmds:
    print(f'\n=== {cmd[:70]} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=20)
    out = stdout.read().decode('utf-8', errors='replace')[:2000]
    print(out)
    err = stderr.read().decode('utf-8', errors='replace')[:500]
    if err.strip():
        print('STDERR:', err)

ssh.close()
print('\nDeploy complete!')