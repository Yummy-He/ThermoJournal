"use strict";
const standalone = (()=>{
  let root=null,archive=new Map(),busy=false,pending=null;
  const connected=new Map();
  const canWrite=()=>Boolean(root && !busy);
  const hasBluetooth=Boolean(navigator.bluetooth?.requestDevice);
  function snapshot(){
    return {devices:Object.fromEntries([...archive].map(([key,d])=>[key,d.name])),task:{busy,revision:0}};
  }
  function records(address){
    return (archive.get(address)?.rows || []).map(r=>[r[1],...r.slice(2,6).map(Number)]);
  }
  function message(error){
    if(error.name==="NotFoundError")return "没有选中设备或找不到历史服务。请确认型号为 LYWSD03MMC，并退出米家设备页。";
    if(error.name==="SecurityError")return "浏览器限制了此次访问。请使用桌面 Chrome；若本地文件模式受限，可将同一 HTML 放在 HTTPS 静态站点上打开。";
    if(error.name==="NotAllowedError")return "浏览器未授予所需权限。请重新选择设备或数据文件夹。";
    return error.message || String(error);
  }
  function controls(){
    $("sync").disabled=!canWrite() || !state.address || !hasBluetooth;
    $("scan").disabled=!canWrite() || !hasBluetooth;
    $("merge").disabled=!canWrite();
    $("openFolder").disabled=busy || !window.showDirectoryPicker;
    $("importCsv").disabled=busy;
    $("add").disabled=!canWrite() || !hasBluetooth;
    $("allcsv").disabled=busy || !archive.size;
    $("form").hidden=!pending;
    for(const el of $("known").querySelectorAll(".edit-alias"))el.disabled=!canWrite();
    if(!root && !archive.size)$("summary").textContent="选择已有 data 文件夹继续归档，或打开 CSV 查看趋势。";
    $("archiveMode").textContent=root?"数据目录："+root.name:archive.size?"CSV 查看模式":"尚未打开数据目录";
    $("capability").textContent=!hasBluetooth?"此浏览器可查看 CSV。蓝牙刷新请使用桌面 Chrome。":
      !window.showDirectoryPicker?"此浏览器无法直接写入目录，可选择 CSV 查看记录。":"";
  }
  async function redraw(reset=false){
    if(!archive.has(state.address))state.address=archive.keys().next().value || "";
    state.devices=snapshot().devices;
    deviceList();
    await loadRows(!reset);
    controls();
  }
  async function run(work){
    if(busy)return;
    busy=true;controls();
    try{await work()}catch(error){if(error.name!=="AbortError")msg(message(error))}
    finally{busy=false;controls()}
  }
  async function openFolder(){
    const selected=await window.showDirectoryPicker({id:"thermojournal",mode:"readwrite"});
    const folder=selected.name.toLowerCase()==="data"?selected:await selected.getDirectoryHandle("data",{create:true});
    const next=await Archive.load(folder);
    root=folder;archive=next;pending=null;connected.clear();
    await redraw(true);msg(next.size?"已打开数据目录。":"已打开空数据目录，可以添加设备。");
  }
  async function viewCsv(files){
    if(!files.length)return;
    const next=new Map();
    for(const file of files){
      const fallback={address:"web-"+crypto.randomUUID(),name:"导入记录 "+(next.size+1)};
      Archive.insertCsv(next,Archive.parse(await file.text(),fallback));
    }
    root=null;archive=next;pending=null;connected.clear();
    await redraw(true);msg("CSV 已打开。需要刷新蓝牙时，请打开可写的 data 文件夹。");
  }
  async function change(work){
    if(!root)throw Error("请先打开可写的数据目录。");
    const action=async()=>{
      // Re-read inside the lock so another tab's recent export is preserved.
      const fresh=await Archive.load(root);
      await work(fresh);
      archive=fresh;
    };
    if(navigator.locks)await navigator.locks.request("thermojournal-archive",action);
    else await action();
  }
  function boundTo(map,device){
    return [...map.values()].find(d=>d.browserIds?.includes(device.id));
  }
  function offer(device,requested){
    const known=boundTo(archive,device);
    if(known && requested && known.address!==requested)throw Error("选中的是「"+known.name+"」，请切换到对应设备。");
    pending=device;
    const target=$("archiveTarget");
    target.replaceChildren(new Option("新建设备档案",""));
    for(const d of archive.values())target.add(new Option(d.name+" · "+d.address.slice(-5),d.address));
    target.value=known?.address || requested || "";
    target.disabled=Boolean(known || requested);
    $("mac").value="";$("mac").required=false;
    updateForm();
    $("form").hidden=false;
    if(!$("dialog").open)$("dialog").showModal();
    msg("已选中 "+(device.name || "蓝牙设备")+"。请核对实物与归档目标，保存关联后即可刷新。");
  }
  function updateForm(){
    const existing=archive.get($("archiveTarget").value);
    $("name").value=existing?.name || pending?.name || "温湿度计";
    $("name").readOnly=Boolean(existing);
    $("mac").parentElement.hidden=Boolean(existing);
  }
  async function register(){
    if(!pending)throw Error("请先选择蓝牙设备。");
    const device=pending, target=$("archiveTarget").value;
    const key=target || ($("mac").value.trim()?Archive.id($("mac").value.trim()):"web-"+crypto.randomUUID());
    const alias=Archive.name($("name").value);
    await change(async fresh=>{
      const linked=boundTo(fresh,device);
      if(linked && linked.address!==key)throw Error("该设备已关联到另一个档案。");
      if(!target && fresh.has(key))throw Error("该地址已有档案，请在归档目标中选择它。");
      if(target && !fresh.has(key))throw Error("目标档案不存在，请重新打开目录。");
      const d=fresh.get(key) || {address:key,name:alias,rows:[]};
      d.browserIds=[...new Set([...(d.browserIds || []),device.id])];
      fresh.set(key,d);
      await Archive.persist(root,fresh,key);
    });
    connected.set(key,device);state.address=key;pending=null;
    $("dialog").close();await redraw(true);msg("设备已关联，点击「刷新蓝牙数据」读取历史。");
  }
  async function sync(){
    const key=state.address;
    let device=connected.get(key);
    if(!device){
      device=await SensorHistory.choose();
      if(boundTo(archive,device)?.address!==key){offer(device,key);return}
      connected.set(key,device);
    }
    msg("正在连接 "+archive.get(key).name+"…");
    const incoming=await SensorHistory.collect(device,msg);
    let added=0;
    await change(async fresh=>{
      if(boundTo(fresh,device)?.address!==key)throw Error("设备关联发生变化，请重新选择。");
      const d=fresh.get(key), old=d.rows.length;
      d.rows=Archive.merge(d.rows,incoming);added=d.rows.length-old;
      await Archive.persist(root,fresh,key,incoming);
    });
    await redraw(true);msg("刷新完成。读取 "+incoming.length+" 条，新增 "+added+" 条。");
  }
  async function rename(address,value){
    const alias=Archive.name(value);
    await change(async fresh=>{
      const d=fresh.get(address);
      if(!d)throw Error("找不到此设备。");
      d.name=alias;await Archive.persist(root,fresh,address);
    });
  }
  function download(address){
    const devices=address?[archive.get(address)]:archive.values();
    const link=document.createElement("a");
    link.href=URL.createObjectURL(new Blob([Archive.encode(devices)],{type:"text/csv;charset=utf-8"}));
    link.download=address?address.replaceAll(":","")+"_历史.csv":"温湿度总表.csv";
    link.click();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
  }
  async function start(){
    $("archiveActions").hidden=false;
    $("archiveTargetLabel").hidden=false;
    $("scan").textContent="选择蓝牙设备";
    $("pairHelp").textContent="将温湿度计放在电脑旁，退出米家设备页。首次使用此浏览器时，选择实物，再关联已有档案或新建设备。";
    $("macLabel").textContent="已知 MAC 地址（可选）";
    $("archiveTarget").onchange=updateForm;
    $("openFolder").onclick=()=>run(openFolder);
    $("importCsv").onclick=()=>$("csvFiles").click();
    $("csvFiles").onchange=e=>{const files=[...e.target.files];e.target.value="";run(()=>viewCsv(files))};
    $("download").onclick=e=>{e.preventDefault();if(state.rows.length)download(state.address)};
    $("allcsv").onclick=e=>{e.preventDefault();if(archive.size)download()};
    $("dialog").addEventListener("close",()=>{pending=null;controls()});
    await redraw(true);
  }
  return {snapshot,records,controls,start,run,rename,register,sync,
    scan:async()=>offer(await SensorHistory.choose(),""),
    merge:async()=>{await change(fresh=>Archive.persist(root,fresh));await redraw();msg("所有设备档案已重新合并。")}};
})();
