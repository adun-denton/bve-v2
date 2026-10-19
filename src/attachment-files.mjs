// Opaque, bounded attachment I/O. No SQLite, decoder, execution or transport.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {StoreError} from './domain-store.mjs';
import {validate,LIMITS} from './contracts/3djat.mjs';

export const ATTACHMENT_IO_LIMITS=Object.freeze({bufferBytes:1024**2,registeredCount:512,
  registeredBytes:1024**3,reviewBytes:1024**3,stagingFiles:64,stagingBytes:1024**3});
const check=(ok,code)=>{if(!ok)throw new StoreError(code);};
const within=(a,b)=>{const r=path.relative(a,b);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink;
const shapePath=relative=>check(validate('revision-ref',{id:'attachment-path',revision:1,path:relative,sha256:'0'.repeat(64)}).ok,'UNSAFE_PATH');
const nofollow=fs.constants.O_NOFOLLOW??0;
const openRead=file=>fs.openSync(file,fs.constants.O_RDONLY|nofollow);

class SourceRoot {
  constructor(root){
    check(typeof root==='string'&&path.isAbsolute(root)&&!root.startsWith('\\\\')&&!root.startsWith('//'),'UNSAFE_PATH');
    this.root=path.resolve(root);let current=path.parse(this.root).root;
    for(const part of this.root.slice(current.length).split(path.sep).filter(Boolean)){
      current=path.join(current,part);const s=fs.lstatSync(current);
      check(s.isDirectory()&&!s.isSymbolicLink()&&fs.readdirSync(path.dirname(current)).includes(part),'UNSAFE_PATH');
    }
    this.identity=fs.statSync(this.root);
  }
  locate(relative){
    shapePath(relative);const s=fs.statSync(this.root);check(s.dev===this.identity.dev&&s.ino===this.identity.ino&&fs.realpathSync.native(this.root)===this.root,'ROOT_CHANGED');
    let current=this.root;const parts=relative.split('/');
    for(const [i,part] of parts.entries()){
      current=path.join(current,part);const st=fs.lstatSync(current);
      check(!st.isSymbolicLink()&&st.dev===this.identity.dev&&(i===parts.length-1?st.isFile()&&st.nlink===1:st.isDirectory()),'UNSAFE_PATH');
      check(within(this.root,fs.realpathSync.native(current))&&fs.readdirSync(path.dirname(current)).includes(part),'UNSAFE_PATH');
    }
    return current;
  }
}

function streamed(file,max,{hook=()=>{},write=null,links=1}={}){
  let fd;try{
    fd=openRead(file);const before=fs.fstatSync(fd);
    check(before.isFile()&&before.nlink===links,'UNSAFE_PATH');check(before.size<=max,'HASH_MISMATCH');
    const h=createHash('sha256'),buffer=Buffer.alloc(ATTACHMENT_IO_LIMITS.bufferBytes);let bytes=0,n;
    while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){
      bytes+=n;check(bytes<=max,'HASH_MISMATCH');h.update(buffer.subarray(0,n));
      if(write!==null){let at=0;while(at<n){const written=fs.writeSync(write,buffer,at,n-at);check(written>0,'CAPABILITY_UNAVAILABLE');at+=written;}}
      hook('attachment-chunk',{bytes,bufferBytes:buffer.length});
    }
    check(bytes===before.size&&same(before,fs.fstatSync(fd))&&same(before,fs.lstatSync(file)),'FILE_CHANGED');
    return {bytes,sha256:h.digest('hex'),identity:before};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

export class AttachmentFiles {
  constructor(store,{sources={},hook=()=>{},privatePaths=[]}={}){this.store=store;this.sources=sources;this.hook=hook;this.privatePaths=privatePaths;this.guards=new Map();this.configuration();}
  configuration(){
    check(this.sources&&typeof this.sources==='object'&&!Array.isArray(this.sources)&&Object.keys(this.sources).length<=16,'INVALID_VALUE');
    for(const [id,entry] of Object.entries(this.sources)){
      check(validate('revision-ref',{id,revision:1,path:'source.json',sha256:'0'.repeat(64)}).ok,'INVALID_VALUE');
      check(entry&&Object.keys(entry).length===2&&Object.hasOwn(entry,'root')&&Object.hasOwn(entry,'products')&&
        typeof entry.root==='string'&&path.isAbsolute(entry.root)&&!entry.root.startsWith('\\\\')&&!entry.root.startsWith('//')&&
        Array.isArray(entry.products)&&entry.products.length>0&&entry.products.length<=256&&new Set(entry.products).size===entry.products.length,'INVALID_VALUE');
      for(const productId of entry.products)check(validate('artifact-ref',{productId,artifactId:productId,version:1,sha256:'0'.repeat(64),width:1,height:1}).ok,'INVALID_VALUE');
      const root=path.resolve(entry.root);
      check(!within(root,this.store.root),'UNSAFE_PATH'); // No broad master-root/ancestor scope.
      const protectedPaths=['Domain','Heads','Receipts','Staging','Recovery',this.store.workspace.paths.operations].map(p=>path.join(this.store.root,...p.split('/'))).concat(this.privatePaths);
      check(protectedPaths.every(p=>!within(root,p)&&!within(p,root)),'UNSAFE_PATH');
    }
  }
  destination(record){return `${this.store.workspace.paths.products}/${record.productId}/Sources/${record.sha256}.bin`;}
  authorize(record){
    this.configuration();check(record.source.kind==='file','CAPABILITY_UNAVAILABLE');
    const entry=Object.hasOwn(this.sources,record.source.sourceId)?this.sources[record.source.sourceId]:null;check(entry&&entry.products.includes(record.productId),'INVALID_SCOPE');
    check(record.availability==='available','CAPABILITY_UNAVAILABLE');
    check(record.location===this.destination(record),'UNSAFE_PATH');return entry;
  }
  budget(view,record){
    const all=[...view.records.values()].filter(r=>r.kind==='attachment');
    check(all.length<ATTACHMENT_IO_LIMITS.registeredCount&&all.reduce((n,r)=>n+r.value.bytes,record.bytes)<=ATTACHMENT_IO_LIMITS.registeredBytes,'OUT_OF_BOUNDS');
    let count=0,bytes=record.bytes;
    for(const p of view.head.products){
      const relative=`${this.store.workspace.paths.products}/${p.productId}/Sources/Attachment-Staging`;
      // Validate ancestors without treating the directory as a metadata file.
      const probe=this.store.safe(relative+'/probe');const directory=path.dirname(probe);
      if(!fs.existsSync(directory))continue;
      for(const name of fs.readdirSync(directory)){
        check(++count<ATTACHMENT_IO_LIMITS.stagingFiles,'OUT_OF_BOUNDS');
        const file=this.store.safe(relative+'/'+name);bytes+=fs.lstatSync(file).size;
        check(bytes<=ATTACHMENT_IO_LIMITS.stagingBytes,'OUT_OF_BOUNDS');
      }
    }
  }
  #pairedFile(relative){
    // Internal crash reconciliation only: all ancestors retain the ordinary
    // guard. A two-link final file must match one exact owned staging inode.
    this.store.safe(path.posix.dirname(relative)+'/pair-check');
    const full=path.join(this.store.root,...relative.split('/')),stat=fs.lstatSync(full);
    check(stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===this.store.rootIdentity.dev&&stat.nlink===2&&
      fs.realpathSync.native(full)===full&&fs.readdirSync(path.dirname(full)).includes(path.basename(full)),'UNSAFE_PATH');
    return {full,stat};
  }
  #reconcileLink(record){
    this.store.safe(path.posix.dirname(record.location)+'/pair-check');
    const full=path.join(this.store.root,...record.location.split('/'));let stat;
    try{stat=fs.lstatSync(full);}catch(e){if(e.code==='ENOENT')return;throw e;}
    if(stat.nlink===1)return;
    const final=this.#pairedFile(record.location),directory=`${this.store.workspace.paths.products}/${record.productId}/Sources/Attachment-Staging`;
    this.store.safe(directory+'/pair-check');const names=fs.readdirSync(path.join(this.store.root,directory));check(names.length<=ATTACHMENT_IO_LIMITS.stagingFiles,'OUT_OF_BOUNDS');
    const matches=[];
    for(const name of names){
      if(!new RegExp('^'+record.sha256+'\\.[0-9a-f-]{36}\\.part$').test(name))continue;
      const stat=fs.lstatSync(path.join(this.store.root,directory,name));
      if(stat.nlink!==2||stat.dev!==final.stat.dev||stat.ino!==final.stat.ino)continue;
      const candidate=this.#pairedFile(directory+'/'+name);
      if(candidate.stat.dev===final.stat.dev&&candidate.stat.ino===final.stat.ino)matches.push(candidate);
    }
    check(matches.length===1,'UNSAFE_PATH');const staged=matches[0],measured=streamed(final.full,record.bytes,{links:2});
    check(measured.bytes===record.bytes&&measured.sha256===record.sha256&&same(final.stat,fs.lstatSync(final.full))&&same(staged.stat,fs.lstatSync(staged.full)),'HASH_MISMATCH');
    fs.unlinkSync(staged.full);this.store.syncDirectory(path.dirname(staged.full));this.store.syncDirectory(path.dirname(final.full));this.store.safe(record.location);
    this.hook('attachment-link-reconciled',{location:record.location});
  }
  capture(record,view){
    const entry=this.authorize(record),capturedRoot=path.resolve(entry.root);this.#reconcileLink(record);this.budget(view,record);
    const cached=this.guards.get(record.source.sourceId);
    check(!cached||cached.root===path.resolve(entry.root),'ROOT_CHANGED');
    const source=cached??new SourceRoot(entry.root);this.guards.set(record.source.sourceId,source);
    const sourcePath=source.locate(record.source.location),sourceStat=fs.lstatSync(sourcePath);
    check(sourceStat.size===record.bytes&&sourceStat.size<=LIMITS.attachmentBytes,'HASH_MISMATCH');
    const destination=this.store.safe(record.location,true),exists=fs.existsSync(destination);
    check(sourcePath!==destination,'UNSAFE_PATH');
    let temp=null,fd;
    try{
      if(!exists){
        temp=`${this.store.workspace.paths.products}/${record.productId}/Sources/Attachment-Staging/${record.sha256}.${randomUUID()}.part`;
        fd=fs.openSync(this.store.safe(temp,true),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|nofollow,0o600);
      }
      const measured=streamed(sourcePath,record.bytes,{write:fd??null,hook:this.hook});
      check(measured.bytes===record.bytes&&measured.sha256===record.sha256&&same(sourceStat,measured.identity),'HASH_MISMATCH');
      check(same(sourceStat,fs.lstatSync(source.locate(record.source.location))),'FILE_CHANGED');
      if(fd!==undefined){fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;this.store.syncDirectory(path.dirname(this.store.safe(temp)));}
      this.hook('attachment-staged',{location:temp});
      if(exists)this.verify(record);
      else{
        const staged=this.store.safe(temp);check(streamed(staged,record.bytes).sha256===record.sha256,'HASH_MISMATCH');
        // Atomic no-overwrite byte publication. Only our newly created staging
        // link is removed; failed/partial files and all directories are retained.
        fs.linkSync(staged,this.store.safe(record.location));this.hook('attachment-linked',{location:record.location,staging:temp});fs.unlinkSync(staged);
        this.store.syncDirectory(path.dirname(destination));this.store.syncDirectory(path.dirname(staged));
      }
      this.hook('attachment-installed',{location:record.location});
      const proof=()=>{
        check(path.resolve(this.authorize(record).root)===capturedRoot,'INVALID_SCOPE');
        check(same(sourceStat,fs.lstatSync(source.locate(record.source.location))),'FILE_CHANGED');this.verify(record);
      };
      proof();return proof;
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  verify(record){
    const file=this.store.safe(record.location),result=streamed(file,record.bytes);
    this.store.safe(record.location);check(result.bytes===record.bytes&&result.sha256===record.sha256,'HASH_MISMATCH');return result;
  }
  availability(records){
    let budget=0;return records.map(row=>{
      let current;try{
        budget+=row.record.bytes;check(budget<=ATTACHMENT_IO_LIMITS.reviewBytes,'OUT_OF_BOUNDS');this.verify(row.record);
        current={status:'available',cause:null};
      }catch(e){current={status:['ENOENT','MISSING_REFERENCE'].includes(e.code)?'missing':['HASH_MISMATCH','FILE_CHANGED'].includes(e.code)?'corrupt':'unavailable',cause:e.code??'IO_FAILURE'};}
      return {...row,current};
    });
  }
}
