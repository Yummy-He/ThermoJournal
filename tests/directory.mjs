import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdtemp,mkdir,readFile,readdir,rename,rm,stat,writeFile} from "node:fs/promises";
import {join,basename} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import vm from "node:vm";

const source=readFileSync(new URL("../app/web/archive.js",import.meta.url),"utf8");
const archive=vm.runInNewContext(source+"\nArchive",{crypto:globalThis.crypto});
class Directory {
  constructor(path){this.path=path;this.kind="directory";this.name=basename(path)}
  async entry(name,create,directory){
    const path=join(this.path,name);
    if(create && directory)await mkdir(path,{recursive:true});
    if(create && !directory)await writeFile(path,"",{flag:"a"});
    try{assert.equal((await stat(path)).isDirectory(),directory)}
    catch(e){if(e.code==="ENOENT")throw new DOMException(name,"NotFoundError");throw e}
    if(directory)return new Directory(path);
    return {kind:"file",name,getFile:async()=>({text:()=>readFile(path,"utf8")}),
      createWritable:async()=>({
        write:text=>writeFile(path+".work",text),
        close:()=>rename(path+".work",path),
        abort:()=>rm(path+".work",{force:true})
      })};
  }
  getDirectoryHandle(name,options={}){return this.entry(name,options.create,true)}
  getFileHandle(name,options={}){return this.entry(name,options.create,false)}
  async *values(){for(const f of await readdir(this.path,{withFileTypes:true}))yield await this.entry(f.name,false,f.isDirectory())}
  removeEntry(name){return rm(join(this.path,name))}
}
test("legacy directory, Web Bluetooth identity, raw recovery, rename and idempotent merge",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"thermo-archive-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=new Directory(dir), address="02:00:00:00:00:01", key="web-"+crypto.randomUUID();
  const row=["1","2026-02-10T17:00:00+08:00","1.0","2.0","40","50","3600"];
  const first={address,name:"一号",rows:[row]}, second={address:key,name:"二号",browserIds:["test-device"],rows:[row]};
  const legacy=await root.getDirectoryHandle(address.replaceAll(":",""),{create:true});
  const raw=await legacy.getDirectoryHandle("raw_exports",{create:true});
  await writeFile(join(legacy.path,"device.json"),JSON.stringify({address,name:first.name}));
  const oldCsv=archive.encode([first]).split("\r\n").filter(Boolean).map(line=>line.split(",").slice(2).join(",")).join("\r\n");
  await writeFile(join(raw.path,"old.csv"),oldCsv);
  let map=await archive.load(root);
  assert.equal(map.get(address).rows.length,1);
  map.set(key,second);await archive.persist(root,map,key,second.rows);
  map=await archive.load(root);
  assert.deepEqual([...map.get(key).browserIds],["test-device"]);
  map.get(address).name="改名";
  await archive.persist(root,map);
  const merged=await readFile(join(dir,"all_devices.csv"),"utf8");
  assert.deepEqual([...archive.parse(merged)].map(r=>r.name).sort(),["二号","改名"].sort());
  await archive.persist(root,await archive.load(root));
  assert.equal(await readFile(join(dir,"all_devices.csv"),"utf8"),merged);
  assert.equal(await readFile(join(raw.path,"old.csv"),"utf8"),oldCsv);
  // Recover the derived tables after interruption using complete raw exports.
  await rm(join(dir,"all_devices.csv"));
  await rm(join(dir,key,"history.csv"));
  assert.equal((await archive.load(root)).get(key).rows.length,1);
});
