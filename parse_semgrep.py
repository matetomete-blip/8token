import json, os
p = '/workspace/.source-aware/semgrep.json'
print('Size:', os.path.getsize(p))
with open(p) as f:
    d = json.load(f)
results = d.get('results', [])
print('Count:', len(results))
for r in results[:50]:
    print(r['check_id'], r['path'] + ':' + str(r['start']['line']))