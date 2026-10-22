import json
d=json.load(open('scripts/talent_seed.json'))
def q(v):
    if v is None or v=='': return 'NULL'
    if isinstance(v,(int,float)): return str(int(v))
    return "'"+str(v).replace("'","''")+"'"
rows=[]
for r in d:
    ex='Exclusive' if (r['source']=='roster' and r.get('status')=='Exclusive') else 'Non-Exclusive'
    rows.append("(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"%tuple(q(x) for x in [
        r['id'],r['name'],ex,r.get('region'),r.get('niche'),r.get('gender'),
        r.get('ig_followers'),r.get('tt_followers'),r.get('yt_followers'),r.get('rate'),
        r.get('instagram'),r.get('tiktok'),r.get('youtube'),r.get('photo'),r.get('public_bio')]))
sql="-- One-off import of the 335 talent from the original dashboard (safe to re-run: skips existing ids)\nINSERT INTO talents (id,name,exclusivity,region,niche,gender,ig_followers,tt_followers,yt_followers,rate,instagram,tiktok,youtube,photo,public_bio) VALUES\n"+",\n".join(rows)+"\nON CONFLICT (id) DO NOTHING;\nUPDATE sync_state SET version = version + 1 WHERE id = 1;\n"
open('netlify/database/migrations/2_seed_talent.sql','w').write(sql)
print(len(rows), len(sql))
