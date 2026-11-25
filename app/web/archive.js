"use strict";
const Archive = (() => {
  const fields = ["设备记录序号","时段结束时间（北京时间，估算）","最低温度（℃）","最高温度（℃）","最低相对湿度（%）","最高相对湿度（%）","设备计时（秒）"];
  const masterName = "all_devices.csv";
  const equal = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
  const order = (a,b) => Date.parse(a[1])-Date.parse(b[1]) || Number(a[0])-Number(b[0]);
  function name(value) {
    const text = String(value ?? "").trim();
    if(!text || text.length>60 || /^[=+@-]|[\x00-\x1f]/.test(text)) throw Error("请输入有效的设备别名（1–60 字）。");
    return text;
  }
  function id(value) {
    if(/^web-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) return value.toLowerCase();
    const address=String(value).replaceAll("-",":").toUpperCase();
    if(!/^(?:[A-F\d]{2}:){5}[A-F\d]{2}$/.test(address)) throw Error("无法识别档案中的设备标识。");
    return address;
  }
  function csvRows(text) {
    text=text.replace(/^\uFEFF/,"");
    const rows=[]; let row=[], cell="", quoted=false, closed=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c!=='"'){cell+=c;continue}
        if(text[i+1]==='"'){cell+='"';i++;continue}
        quoted=false;closed=true;continue;
      }
      if(c===","){row.push(cell);cell="";closed=false;continue}
      if(c==="\r" || c==="\n"){
        if(c==="\r" && text[i+1]==="\n")i++;
        row.push(cell);if(row.length>1 || cell)rows.push(row);
        row=[];cell="";closed=false;continue;
      }
      if(closed || (c==='"' && cell))throw Error("CSV 引号格式不正确。");
      if(c==='"')quoted=true;else cell+=c;
    }
    if(quoted)throw Error("CSV 引号未闭合。");
    if(row.length || cell || closed){row.push(cell);rows.push(row)}
    return rows;
  }
  function parse(text, fallback) {
    const [header,...records]=csvRows(text);
    const full=header && equal(header.slice(2),fields) && header[0]==="设备名称" && ["蓝牙地址","设备标识"].includes(header[1]);
    if(!header || (!full && !equal(header,fields)))throw Error("CSV 表头不属于温湿度手记。");
    return records.map((row,index)=>{
      const line=index+2;
      if(row.length!==header.length)throw Error("CSV 第 "+line+" 行列数异常。");
      const values=full?row.slice(2):row;
      const [seq,time,lo,hi,dry,wet,seconds]=values;
      if(!/^\d+$/.test(seq) || !/^\d+$/.test(seconds) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) ||
         !Number.isFinite(Date.parse(time)) || ![lo,hi,dry,wet].every(v=>/^-?\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(+v)) ||
         +lo>+hi || +dry<0 || +wet>100 || +dry>+wet)throw Error("CSV 第 "+line+" 行记录无效。");
      const address=full?id(row[1]):fallback?.address;
      if(!address || (fallback?.strict && address!==fallback.address))throw Error("记录与所在设备目录不符。");
      return {address,name:full?name(row[0]):fallback.name,values};
    });
  }
  function encode(devices) {
    const lines=[];
    let usesKey=false;
    for(const device of devices){
      usesKey ||= device.address.startsWith("web-");
      for(const row of device.rows)lines.push([device.name,device.address,...row]);
    }
    lines.sort((a,b)=>Date.parse(a[3])-Date.parse(b[3]) || a[1].localeCompare(b[1]));
    lines.unshift(["设备名称",usesKey?"设备标识":"蓝牙地址",...fields]);
    const escape=v=>/[",\r\n]/.test(v)?'"'+String(v).replaceAll('"','""')+'"':String(v);
    return "\uFEFF"+lines.map(row=>row.map(escape).join(",")).join("\r\n")+"\r\n";
  }
  function merge(existing,incoming) {
    const seen=new Map(), rows=[];
    for(const row of [...existing,...incoming]){
      const key=Number(row[0])+"/"+Number(row[6]), time=Date.parse(row[1]);
      const list=seen.get(key) || [];
      const match=list.find(entry=>Math.abs(entry.time-time)<1800000);
      if(match){
        if(![2,3,4,5].every(i=>Number(match.row[i])===Number(row[i])))throw Error("记录 "+row[0]+" 与已有数据冲突，请检查所选设备。");
        continue;
      }
      list.push({time,row});seen.set(key,list);rows.push(row);
    }
    return rows.sort(order);
  }
  async function optional(dir,key,directory=false){
    try{return await (directory?dir.getDirectoryHandle(key):dir.getFileHandle(key))}
    catch(error){if(error.name==="NotFoundError")return null;throw error}
  }
  async function read(handle){return (await handle.getFile()).text()}
  async function write(dir,key,text){
    const previous=await optional(dir,key);
    const handle=previous || await dir.getFileHandle(key,{create:true});
    let stream;
    try{
      stream=await handle.createWritable();
      await stream.write(text);
      await stream.close();
    }catch(error){
      if(stream)await stream.abort().catch(()=>{});
      if(!previous)await dir.removeEntry(key).catch(()=>{});
      throw error;
    }
  }
  function insertCsv(map,items) {
    const groups=new Map();
    for(const r of items){
      if(!map.has(r.address))map.set(r.address,{address:r.address,name:r.name,rows:[]});
      if(!groups.has(r.address))groups.set(r.address,[]);
      groups.get(r.address).push(r.values);
    }
    for(const [address,rows] of groups){const d=map.get(address);d.rows=merge(d.rows,rows)}
  }
  async function load(root){
    const map=new Map();
    for await(const dir of root.values()){
      if(dir.kind!=="directory")continue;
      const meta=await optional(dir,"device.json");
      if(!meta)continue;
      const info=JSON.parse(await read(meta)),address=id(info.address);
      if(dir.name.toLowerCase()!==address.replaceAll(":","").toLowerCase() || map.has(address))throw Error("设备目录和标识不一致。");
      const device={...info,address,name:name(info.name),rows:[]};
      map.set(address,device);
      const files=[],history=await optional(dir,"history.csv"),raw=await optional(dir,"raw_exports",true);
      if(history)files.push(history);
      if(raw)for await(const f of raw.values())if(f.kind==="file" && f.name.endsWith(".csv"))files.push(f);
      const rows=[];
      for(const f of files){
        try{for(const r of parse(await read(f),{...device,strict:true}))rows.push(r.values)}
        catch(error){throw Error(f.name+"："+error.message)}
      }
      device.rows=merge([],rows);
    }
    const master=await optional(root,masterName);
    if(master)insertCsv(map,parse(await read(master)));
    return map;
  }
  async function persist(root,map,changed,rawRows){
    const targets=changed?[map.get(changed)]:[...map.values()];
    for(const device of targets){
      const dir=await root.getDirectoryHandle(device.address.replaceAll(":",""),{create:true});
      const {rows,...info}=device;
      await write(dir,"device.json",JSON.stringify(info,null,2));
      if(rawRows?.length){
        const raw=await dir.getDirectoryHandle("raw_exports",{create:true});
        await write(raw,"history_"+new Date().toISOString().replace(/[:.]/g,"-")+"_"+crypto.randomUUID().slice(0,8)+".csv",encode([{...device,rows:rawRows}]));
      }
      await write(dir,"history.csv",encode([device]));
    }
    await write(root,masterName,encode(map.values()));
  }
  return {load,persist,parse,encode,merge,insertCsv,id,name};
})();
