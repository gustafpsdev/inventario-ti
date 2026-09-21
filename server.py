from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import sqlite3, json, os, hashlib, hmac, base64, secrets, mimetypes, csv, io, shutil, threading, time
from datetime import datetime, timedelta, timezone

ROOT=Path(__file__).resolve().parent
DB=ROOT/'data'/'inventory.db'
STATIC=ROOT/'static'
BACKUP_DIR=ROOT/'backups'
HOST=os.environ.get('HOST','0.0.0.0')
PORT=int(os.environ.get('PORT','8086'))


def load_secret():
    env=os.environ.get('APP_SECRET')
    if env: return env.encode()
    p=ROOT/'data'/'app_secret.txt'
    if not p.exists():
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(secrets.token_urlsafe(48),encoding='utf-8')
    return p.read_text(encoding='utf-8').strip().encode()

SECRET=load_secret()


def db():
    con=sqlite3.connect(DB,timeout=10)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA busy_timeout=10000')
    return con


def ensure_schema():
    con=db()
    con.executescript('''
    CREATE TABLE IF NOT EXISTS audit_logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
    ''')
    con.commit(); con.close()


def audit(actor,action,entity_type='',entity_id=None,details=''):
    try:
        con=db(); con.execute('insert into audit_logs(actor,action,entity_type,entity_id,details) values(?,?,?,?,?)',(actor or 'sistema',action,entity_type,entity_id,details)); con.commit(); con.close()
    except Exception as e:
        print('[audit]',e)


def hash_password(password,salt=None):
    salt=salt or secrets.token_hex(16)
    dk=hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),160000)
    return base64.b64encode(dk).decode(),salt


def ensure_admin():
    con=db(); row=con.execute('select count(*) c from users').fetchone()
    if row['c']==0:
        pwd=os.environ.get('ADMIN_PASSWORD')
        if not pwd:
            raise RuntimeError('Defina ADMIN_PASSWORD antes da primeira execução.')
        ph,salt=hash_password(pwd)
        con.execute('insert into users(username,password_hash,salt,role,display_name) values(?,?,?,?,?)',('admin',ph,salt,'ti','Administrador TI'))
        con.commit()
    con.close()


def make_token(user):
    payload=json.dumps({'u':user['username'],'r':user['role'],'n':user['display_name'],'exp':int((datetime.now(timezone.utc)+timedelta(hours=12)).timestamp())},separators=(',',':')).encode()
    b=base64.urlsafe_b64encode(payload).rstrip(b'=')
    sig=hmac.new(SECRET,b,hashlib.sha256).digest()
    return (b+b'.'+base64.urlsafe_b64encode(sig).rstrip(b'=')).decode()


def parse_token(token):
    try:
        b,s=token.encode().split(b'.',1)
        sig=base64.urlsafe_b64decode(s+b'='*(-len(s)%4))
        if not hmac.compare_digest(sig,hmac.new(SECRET,b,hashlib.sha256).digest()): return None
        data=json.loads(base64.urlsafe_b64decode(b+b'='*(-len(b)%4)))
        if data['exp']<int(datetime.now(timezone.utc).timestamp()): return None
        return data
    except Exception: return None


def create_backup(reason='automatico'):
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    target=BACKUP_DIR/f'inventory-{stamp}.db'
    src=db(); dst=sqlite3.connect(target)
    try: src.backup(dst)
    finally: dst.close(); src.close()
    audit('sistema','BACKUP','database',None,f'{reason}: {target.name}')
    backups=sorted(BACKUP_DIR.glob('inventory-*.db'),key=lambda p:p.stat().st_mtime,reverse=True)
    for old in backups[30:]:
        try: old.unlink()
        except: pass
    return target


def backup_loop():
    while True:
        time.sleep(6*60*60)
        try: create_backup('automatico 6h')
        except Exception as e: print('[backup]',e)

ASSET_FIELDS=['category','subcategory','location','area','department','owner','status','brand','model','serial','hostname','ip','operating_system','processor','ram','storage','notes']


def serial_conflict(con, serial, exclude_id=None):
    serial=(serial or '').strip()
    if not serial:
        return None
    sql="select id,asset_code,category,model from assets where upper(trim(serial))=upper(trim(?))"
    args=[serial]
    if exclude_id is not None:
        sql += " and id<>?"; args.append(exclude_id)
    return con.execute(sql, args).fetchone()

class App(BaseHTTPRequestHandler):
    server_version='InventarioTI/1.9'
    def log_message(self,fmt,*args): print('[web]',fmt%args)
    def json(self,obj,status=200,headers=None):
        raw=json.dumps(obj,ensure_ascii=False,default=str).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def text(self,raw,ctype='text/plain; charset=utf-8',status=200,headers=None):
        if isinstance(raw,str): raw=raw.encode()
        self.send_response(status); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(raw)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def body(self):
        try: return json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
        except: return {}
    def user(self):
        cookies={}
        for part in self.headers.get('Cookie','').split(';'):
            if '=' in part:
                k,v=part.strip().split('=',1); cookies[k]=v
        return parse_token(cookies.get('session',''))
    def require(self):
        u=self.user()
        if not u: self.json({'error':'Não autenticado'},401); return None
        return u

    def do_GET(self):
        p=urlparse(self.path); path=p.path
        if path=='/': return self.serve('index.html')
        if path.startswith('/static/'): return self.serve(path.replace('/static/','',1))
        if path=='/api/me':
            u=self.user(); return self.json({'authenticated':bool(u),'user':u})
        if path=='/api/dashboard':
            if not self.require(): return
            con=db()
            total=con.execute('select count(*) c from assets').fetchone()['c']
            cats=[dict(r) for r in con.execute('select category label,count(*) value from assets group by category order by value desc')]
            areas=[dict(r) for r in con.execute("select coalesce(nullif(area,''),'NÃO INFORMADO') label,count(*) value from assets group by label order by value desc limit 10")]
            statuses=[dict(r) for r in con.execute("select coalesce(nullif(status,''),'NÃO INFORMADO') label,count(*) value from assets group by label order by value desc")]
            alerts=con.execute('select count(*) c from supplies where quantity<minimum or purchase>0').fetchone()['c']
            win10=con.execute("select count(*) c from assets where category='COMPUTADOR' and upper(operating_system) like '%WINDOWS 10%'").fetchone()['c']
            quarantine=con.execute("select count(*) c from assets where category='QUARENTENA' or upper(status)='QUARENTENA'").fetchone()['c']
            users=con.execute('select count(*) c from users').fetchone()['c']
            con.close(); return self.json({'total':total,'categories':cats,'areas':areas,'statuses':statuses,'supply_alerts':alerts,'windows10':win10,'quarantine':quarantine,'users':users})
        if path=='/api/assets':
            if not self.require(): return
            q=parse_qs(p.query); where=[]; args=[]
            term=q.get('q',[''])[0].strip()
            if term:
                where.append("(asset_code like ? or category like ? or location like ? or owner like ? or brand like ? or model like ? or serial like ? or hostname like ? or ip like ?)")
                args += ['%'+term+'%']*9
            for key in ['category','area','status']:
                v=q.get(key,[''])[0].strip()
                if v: where.append(f'{key}=?'); args.append(v)
            sql='select * from assets'+((' where '+' and '.join(where)) if where else '')+' order by id desc limit 1000'
            con=db(); rows=[dict(r) for r in con.execute(sql,args)]; con.close(); return self.json(rows)
        if path.startswith('/api/assets/'):
            if not self.require(): return
            try: aid=int(path.split('/')[3])
            except: return self.json({'error':'ID inválido'},400)
            con=db(); r=con.execute('select * from assets where id=?',(aid,)).fetchone(); moves=[dict(x) for x in con.execute('select * from movements where asset_id=? order by id desc',(aid,))]; con.close()
            return self.json({'asset':dict(r) if r else None,'movements':moves},404 if not r else 200)
        if path=='/api/supplies':
            if not self.require(): return
            con=db(); rows=[dict(r) for r in con.execute('select *, case when quantity<minimum or purchase>0 then 1 else 0 end alert from supplies order by alert desc, supply_model')]; con.close(); return self.json(rows)
        if path=='/api/options':
            if not self.require(): return
            con=db(); out={}
            option_fields=['category','subcategory','area','department','location','owner','status','brand','model','operating_system','processor','ram','storage']
            for f in option_fields: out[f]=[r[0] for r in con.execute(f"select distinct {f} from assets where trim(coalesce({f},''))<>'' order by {f}")]
            canonical={'category':['COMPUTADOR','IMPRESSORA','MONITOR','TABLET','RELÓGIO DE PONTO','QUARENTENA','REDE','PERIFÉRICO'],'status':['ATIVO','EM ESTOQUE','EM USO','MANUTENÇÃO','QUARENTENA','DESLIGADO','BAIXADO','NÃO SE APLICA'],'operating_system':['WINDOWS 11','WINDOWS 10','LINUX','MACOS','NÃO SE APLICA'],'ram':['4GB','8GB','12GB','16GB','24GB','32GB','64GB'],'storage':['SSD','HD','NVME','NÃO SE APLICA']}
            for key,vals in canonical.items(): out[key]=sorted(set(out.get(key,[])+vals))
            con.close(); return self.json(out)
        if path=='/api/export.csv':
            if not self.require(): return
            con=db(); rows=con.execute('select * from assets order by id').fetchall(); con.close(); s=io.StringIO(); w=csv.writer(s,delimiter=';'); w.writerow(rows[0].keys() if rows else ASSET_FIELDS)
            for r in rows: w.writerow(list(r))
            return self.text('\ufeff'+s.getvalue(),'text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename="inventario.csv"'})
        if path=='/api/audit':
            if not self.require(): return
            q=parse_qs(p.query); limit=min(500,max(1,int(q.get('limit',['200'])[0])))
            con=db(); rows=[dict(r) for r in con.execute('select * from audit_logs order by id desc limit ?',(limit,))]; con.close(); return self.json(rows)
        if path=='/api/users':
            if not self.require(): return
            con=db(); rows=[dict(r) for r in con.execute('select id,username,display_name,role from users order by display_name,username')]; con.close(); return self.json(rows)
        if path=='/api/backups':
            if not self.require(): return
            BACKUP_DIR.mkdir(exist_ok=True)
            rows=[{'name':x.name,'size':x.stat().st_size,'modified':datetime.fromtimestamp(x.stat().st_mtime).strftime('%Y-%m-%d %H:%M:%S')} for x in sorted(BACKUP_DIR.glob('inventory-*.db'),key=lambda p:p.stat().st_mtime,reverse=True)[:20]]
            return self.json(rows)
        self.text('Not found',status=404)

    def do_POST(self):
        path=urlparse(self.path).path
        if path=='/api/login':
            b=self.body(); con=db(); r=con.execute('select * from users where username=?',(b.get('username',''),)).fetchone(); con.close()
            if not r: return self.json({'error':'Usuário ou senha inválidos'},401)
            ph,_=hash_password(b.get('password',''),r['salt'])
            if not hmac.compare_digest(ph,r['password_hash']): return self.json({'error':'Usuário ou senha inválidos'},401)
            audit(r['username'],'LOGIN','session',None,'Login realizado')
            tok=make_token(r); return self.json({'ok':True,'user':{'username':r['username'],'role':r['role'],'display_name':r['display_name']}},headers={'Set-Cookie':f'session={tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200'})
        if path=='/api/logout':
            u=self.user();
            if u: audit(u['u'],'LOGOUT','session',None,'Logout realizado')
            return self.json({'ok':True},headers={'Set-Cookie':'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'})
        if path=='/api/assets':
            u=self.require()
            if not u: return
            b=self.body(); con=db()
            conflict=serial_conflict(con,b.get('serial',''))
            if conflict:
                con.close(); return self.json({'error':f"Serial / Service Tag já cadastrado no ativo {conflict['asset_code']}."},409)
            code=str(b.get('asset_code','')).strip() or None
            if code and con.execute('select 1 from assets where upper(trim(asset_code))=upper(trim(?))',(code,)).fetchone():
                con.close(); return self.json({'error':'Essa identificação do ativo já está em uso.'},409)
            vals=[b.get(f,'').strip() if isinstance(b.get(f,''),str) else b.get(f,'') for f in ASSET_FIELDS]
            con.execute('insert into assets(asset_code,'+','.join(ASSET_FIELDS)+') values(?,'+','.join('?'*len(ASSET_FIELDS))+')',[code]+vals)
            aid=con.execute('select last_insert_rowid() id').fetchone()['id']; con.execute('insert into movements(asset_id,action,note,actor) values(?,?,?,?)',(aid,'CADASTRO','Ativo cadastrado no sistema',u['u'])); con.commit(); con.close(); audit(u['u'],'CADASTRO','asset',aid,code or 'sem identificação'); return self.json({'ok':True,'id':aid,'asset_code':code},201)
        if path.endswith('/move') and path.startswith('/api/assets/'):
            u=self.require()
            if not u: return
            try: aid=int(path.split('/')[3])
            except: return self.json({'error':'ID inválido'},400)
            b=self.body(); con=db(); old=con.execute('select * from assets where id=?',(aid,)).fetchone()
            if not old: con.close(); return self.json({'error':'Ativo não encontrado'},404)
            nl=b.get('location',old['location']); no=b.get('owner',old['owner'])
            con.execute('update assets set location=?,owner=?,updated_at=current_timestamp where id=?',(nl,no,aid)); con.execute('insert into movements(asset_id,action,from_location,to_location,from_owner,to_owner,note,actor) values(?,?,?,?,?,?,?,?)',(aid,'MOVIMENTAÇÃO',old['location'],nl,old['owner'],no,b.get('note',''),u['u'])); con.commit(); con.close(); audit(u['u'],'MOVIMENTAÇÃO','asset',aid,f"{old['location']} -> {nl}; {old['owner']} -> {no}"); return self.json({'ok':True})
        if path=='/api/users':
            u=self.require()
            if not u:return
            b=self.body(); username=str(b.get('username','')).strip().lower(); display=str(b.get('display_name','')).strip(); password=str(b.get('password',''))
            if not username or len(password)<8: return self.json({'error':'Informe usuário e senha com pelo menos 8 caracteres.'},400)
            ph,salt=hash_password(password); con=db()
            try:
                con.execute('insert into users(username,password_hash,salt,role,display_name) values(?,?,?,?,?)',(username,ph,salt,'ti',display or username)); con.commit()
            except sqlite3.IntegrityError:
                con.close(); return self.json({'error':'Esse usuário já existe.'},409)
            uid=con.execute('select id from users where username=?',(username,)).fetchone()['id']; con.close(); audit(u['u'],'CRIAÇÃO DE USUÁRIO','user',uid,username); return self.json({'ok':True,'id':uid},201)
        if path=='/api/backup':
            u=self.require()
            if not u:return
            target=create_backup('manual por '+u['u']); return self.json({'ok':True,'name':target.name})
        self.json({'error':'Rota não encontrada'},404)

    def do_PUT(self):
        path=urlparse(self.path).path
        if path.startswith('/api/assets/'):
            u=self.require()
            if not u:return
            try: aid=int(path.split('/')[3])
            except:return self.json({'error':'ID inválido'},400)
            b=self.body(); vals=[b.get(f,'') for f in ASSET_FIELDS]; con=db(); old=con.execute('select * from assets where id=?',(aid,)).fetchone()
            if not old: con.close(); return self.json({'error':'Ativo não encontrado'},404)
            conflict=serial_conflict(con,b.get('serial',''),aid)
            if conflict:
                con.close(); return self.json({'error':f"Serial / Service Tag já cadastrado no ativo {conflict['asset_code']}."},409)
            code=str(b.get('asset_code','')).strip() or None
            if code and con.execute('select 1 from assets where upper(trim(asset_code))=upper(trim(?)) and id<>?',(code,aid)).fetchone():
                con.close(); return self.json({'error':'Essa identificação do ativo já está em uso.'},409)
            con.execute('update assets set asset_code=?,'+','.join(f+'=?' for f in ASSET_FIELDS)+',updated_at=current_timestamp where id=?',[code]+vals+[aid]); con.execute('insert into movements(asset_id,action,note,actor) values(?,?,?,?)',(aid,'EDIÇÃO','Dados do ativo atualizados',u['u'])); con.commit(); con.close(); audit(u['u'],'EDIÇÃO','asset',aid,code or 'sem identificação'); return self.json({'ok':True})
        self.json({'error':'Rota não encontrada'},404)

    def do_DELETE(self):
        path=urlparse(self.path).path
        if path.startswith('/api/assets/'):
            u=self.require()
            if not u:return
            try: aid=int(path.split('/')[3])
            except:return self.json({'error':'ID inválido'},400)
            con=db(); old=con.execute('select asset_code from assets where id=?',(aid,)).fetchone(); con.execute("update assets set status='BAIXADO',updated_at=current_timestamp where id=?",(aid,)); con.execute('insert into movements(asset_id,action,note,actor) values(?,?,?,?)',(aid,'BAIXA','Ativo marcado como BAIXADO',u['u'])); con.commit(); con.close(); audit(u['u'],'BAIXA','asset',aid,old['asset_code'] if old else ''); return self.json({'ok':True})
        if path.startswith('/api/users/'):
            u=self.require()
            if not u:return
            try: uid=int(path.split('/')[3])
            except:return self.json({'error':'ID inválido'},400)
            con=db(); row=con.execute('select username from users where id=?',(uid,)).fetchone()
            if not row: con.close(); return self.json({'error':'Usuário não encontrado'},404)
            if row['username']==u['u']: con.close(); return self.json({'error':'Você não pode excluir seu próprio usuário enquanto estiver logado.'},400)
            if con.execute('select count(*) c from users').fetchone()['c']<=1: con.close(); return self.json({'error':'É necessário manter pelo menos um usuário.'},400)
            con.execute('delete from users where id=?',(uid,)); con.commit(); con.close(); audit(u['u'],'EXCLUSÃO DE USUÁRIO','user',uid,row['username']); return self.json({'ok':True})
        self.json({'error':'Rota não encontrada'},404)

    def serve(self,name):
        path=(STATIC/name).resolve()
        if STATIC.resolve() not in path.parents and path!=STATIC.resolve(): return self.text('Forbidden',status=403)
        if not path.exists() or not path.is_file(): return self.text('Not found',status=404)
        self.text(path.read_bytes(),mimetypes.guess_type(str(path))[0] or 'application/octet-stream',headers={'Cache-Control':'no-cache, no-store, must-revalidate'})

if __name__=='__main__':
    ensure_schema(); ensure_admin()
    try: create_backup('inicialização')
    except Exception as e: print('[backup inicial]',e)
    threading.Thread(target=backup_loop,daemon=True).start()
    print(f'Inventário TI interno: http://localhost:{PORT}')
    print('Rede interna: use http://IP-DESTE-COMPUTADOR:%s' % PORT)
    ThreadingHTTPServer((HOST,PORT),App).serve_forever()
