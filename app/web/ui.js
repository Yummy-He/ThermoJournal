"use strict";
const $ = id => document.getElementById(id);
const dayMs = 86400000, hourMs = dayMs/24;
const state = {address:"", devices:{}, rows:[], period:"month", start:null, anchor:null, preferredDay:1, units:{half:"day",year:"month"}, page:0, selected:-1, task:{}, revision:null};
const iso = time => new Date(time).toISOString().slice(0,10);
const num = n => n.toLocaleString("zh-CN",{maximumFractionDigits:1});
const formatRange = (a,b,unit) => a===Infinity ? "—" : num(a)+" – "+num(b)+" "+unit;
const post = (path, body={}) => api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
async function api(path,options) {
  const response = await fetch(path,options), data = await response.json();
  if(!response.ok) throw Error(data.error || "读取失败");
  return data;
}
function msg(text) {
  $("status").textContent=text; $("status").hidden=!text;
  $("dialogStatus").textContent=text;
}
function bind(id,handler) {
  $(id).addEventListener("click",async()=>{try{await handler()}catch(e){msg(e.message)}});
}
function shiftedDate(row) { return Date.parse(row[0])+8*hourMs; }
const periodMonths={month:1,half:6,year:12};
function midnight(time){return Math.floor(time/dayMs)*dayMs}
function monthShift(time,months,preferredDay=new Date(time).getUTCDate()){
  const d=new Date(time);
  const first=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1);
  const lastDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months+1,0)).getUTCDate();
  return first+(Math.min(preferredDay,lastDay)-1)*dayMs;
}
function naturalStart(time,period){
  const d=new Date(time);
  switch(period){
    case "week":return midnight(time)-((d.getUTCDay()+6)%7)*dayMs;
    case "month":return monthShift(time,0,1);
    case "half":return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()<6?0:6,1);
    case "year":return Date.UTC(d.getUTCFullYear(),0,1);
    default:return midnight(time);
  }
}
function movePeriod(time,dir,period){
  if(period==="day")return time+dir*dayMs;
  if(period==="week")return time+dir*7*dayMs;
  return monthShift(time,dir*periodMonths[period]);
}
function setWindow(start,anchor=start,preferredDay=new Date(start).getUTCDate()){
  state.start=start;state.anchor=anchor;state.preferredDay=preferredDay;
}
function periodBounds(){
  if(state.period==="all"){
    const a=state.rows.length?shiftedDate(state.rows[0]):state.start;
    const b=state.rows.length?shiftedDate(state.rows.at(-1)):a;
    return [midnight(a),midnight(b)+dayMs,b-a>730*dayMs?0:dayMs];
  }
  const start=state.start;
  const step=state.period==="day"?hourMs:state.units[state.period]==="month"?0:dayMs;
  return [start,movePeriod(start,1,state.period),step];
}
let buckets=[], filtered=[], bounds=[], stepUnit="";
const series=[
  {canvas:"temperatureChart",readout:"rangeT",unit:"°C",color:"#ed543b",fill:"255,99,71",precision:.5},
  {canvas:"humidityChart",readout:"rangeH",unit:"%",color:"#327f99",fill:"50,127,153",precision:1}
];
function groupRows(){
  bounds=periodBounds();
  const [start,end,step]=bounds;
  stepUnit=step===hourMs?"小时":step===dayMs?"天":"月";
  buckets=[];filtered=[];
  for(let i=0,t=start;t<end;i++){
    const next=step?t+step:monthShift(start,i+1);
    buckets.push({t,end:Math.min(next,end),n:0,min:[Infinity,Infinity],max:[-Infinity,-Infinity]});
    t=next;
  }
  let index=0;
  for(const row of state.rows){
    const time=shiftedDate(row);
    if(time<start || time>=end)continue;
    filtered.push(row);
    while(index+1<buckets.length && buckets[index+1].t<=time)index++;
    const bucket=buckets[index];
    bucket.n++;
    for(let k=0;k<series.length;k++){
      bucket.min[k]=Math.min(bucket.min[k],row[1+2*k]);
      bucket.max[k]=Math.max(bucket.max[k],row[2+2*k]);
    }
  }
  series.forEach((item,k)=>{
    item.low=buckets.reduce((v,b)=>Math.min(v,b.min[k]),Infinity);
    item.high=buckets.reduce((v,b)=>Math.max(v,b.max[k]),-Infinity);
  });
}
function axisLabel(t){
  const d=new Date(t);
  if(state.period==="day")return String(d.getUTCHours()).padStart(2,"0")+":00";
  if(stepUnit==="月" && d.getUTCDate()===1)return d.getUTCFullYear()+"/"+(d.getUTCMonth()+1);
  return (d.getUTCMonth()+1)+"/"+d.getUTCDate();
}
function clockLabel(time){return new Date(time).toISOString().slice(0,16).replace("T"," ")}
function draw(){
  if(!bounds.length)return;
  const focus=buckets[state.selected];
  let label="时段范围";
  if(focus){
    if(stepUnit==="小时")label=clockLabel(focus.t);
    else if(stepUnit==="月")label=iso(focus.t)+" 至 "+iso(focus.end-1);
    else label=iso(focus.t);
  }
  document.querySelectorAll(".sample-time").forEach(span=>{span.textContent=label});
  series.forEach((item,k)=>{
    $(item.readout).textContent=focus&&!focus.n?"无记录":
      formatRange(focus?focus.min[k]:item.low,focus?focus.max[k]:item.high,item.unit);
    drawSeries(item,k);
  });
}
const axisLabelWidth=42;
const rightInset=1;
function drawSeries(item,k){
  const canvas=$(item.canvas), w=canvas.clientWidth,h=canvas.clientHeight;if(w<10 || !bounds.length)return;
  const ratio=window.devicePixelRatio||1;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
  const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);
  const l=axisLabelWidth,r=w-rightInset,top=15,bottom=h-28;
  const {color,fill,unit,precision}=item;
  ctx.font='12px "Segoe UI","Microsoft YaHei",sans-serif';
  if(item.low===Infinity){ctx.fillStyle="#777a82";ctx.textAlign="center";ctx.fillText(state.address?"此时段没有记录":"添加设备后可查看趋势",w/2,h/2);return;}
  let lo=item.low,hi=item.high;
  const spacing=Math.max(precision,Math.ceil((hi-lo)/4/precision)*precision);
  lo=Math.floor(lo/spacing)*spacing;hi=Math.max(lo+spacing,Math.ceil(hi/spacing)*spacing);
  const x=i=>buckets.length===1?(l+r)/2:l+(r-l)*i/(buckets.length-1);
  const y=v=>bottom-(bottom-top)*(v-lo)/(hi-lo);
  ctx.textAlign="right";
  for(let value=lo;value<=hi+.00001;value+=spacing){
    ctx.fillStyle="#676b73";ctx.fillText(num(value)+unit,l-8,y(value)+4);ctx.strokeStyle="#e9eaed";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(l,y(value));ctx.lineTo(r,y(value));ctx.stroke();
  }
  ctx.textAlign="center";
  const ticks=Math.min(w<500?4:7,buckets.length);
  for(let i=0;i<ticks;i++){
    const j=ticks===1?0:Math.round(i*(buckets.length-1)/(ticks-1));
    const label=axisLabel(buckets[j].t);
    const halfWidth=ctx.measureText(label).width/2;
    ctx.fillText(label,Math.min(r-halfWidth,Math.max(halfWidth,x(j))),h-6);
  }
  const gradient=ctx.createLinearGradient(0,top,0,bottom);
  gradient.addColorStop(0,"rgba("+fill+",.37)");gradient.addColorStop(1,"rgba("+fill+",.07)");
  for(let i=0;i<buckets.length;){
    if(!buckets[i].n){i++;continue;}
    const first=i;while(i<buckets.length&&buckets[i].n)i++;const last=i-1;
    ctx.beginPath();ctx.moveTo(x(first),y(buckets[first].max[k]));
    for(let j=first+1;j<=last;j++)ctx.lineTo(x(j),y(buckets[j].max[k]));
    for(let j=last;j>=first;j--)ctx.lineTo(x(j),y(buckets[j].min[k]));
    ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    for(const key of ["min","max"]){
      ctx.beginPath();ctx.moveTo(x(first),y(buckets[first][key][k]));
      for(let j=first+1;j<=last;j++)ctx.lineTo(x(j),y(buckets[j][key][k]));
      ctx.strokeStyle=key==="max"?color:"rgba("+fill+",.65)";ctx.lineWidth=key==="max"?2.4:1.5;ctx.stroke();
      if(first===last){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(first),y(buckets[first][key][k]),3,0,2*Math.PI);ctx.fill();}
    }
  }
  const focus=buckets[state.selected];
  if(focus){
    const pos=x(state.selected);ctx.strokeStyle="#737782";ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pos,top);ctx.lineTo(pos,bottom);ctx.stroke();

  }
}
function table(){
  const limit=8, end=filtered.length-state.page*limit, rows=filtered.slice(Math.max(0,end-limit),end).reverse();
  $("rows").replaceChildren();
  for(const r of rows){
    const tr=document.createElement("tr");
    for(const val of [r[0].slice(0,16).replace("T"," "),num(r[1])+" °C",num(r[2])+" °C",r[3]+"%",r[4]+"%"]){
      const cell=document.createElement("td");cell.textContent=val;tr.append(cell);
    }
    $("rows").append(tr);
  }
  $("tableInfo").textContent=rows.length?"所选时段共 "+num(filtered.length)+" 条 · 第 "+(state.page+1)+" / "+Math.ceil(filtered.length/limit)+" 页":"此时段没有小时记录";
  $("nextPage").disabled=end<=limit;$("previousPage").disabled=state.page===0;
}
function render(){
  groupRows();state.selected=-1;state.page=0;
  $("dates").textContent=state.period==="day"?clockLabel(bounds[0])+" 至 "+clockLabel(bounds[1])+"（北京时间）":iso(bounds[0])+" 至 "+iso(bounds[1]-1);
  $("legend").textContent="按"+stepUnit+"显示 · 色带上下沿为最高值和最低值";
  $("date").value=iso(bounds[0]);$("date").disabled=$("prev").disabled=$("next").disabled=state.period==="all";
  for(const b of $("period").children){b.classList.toggle("on",b.dataset.p===state.period);b.setAttribute("aria-pressed",b.dataset.p===state.period)}
  $("resolution").hidden=!Object.hasOwn(state.units,state.period);
  for(const b of $("resolution").querySelectorAll("button")){
    const on=b.dataset.unit===state.units[state.period];b.classList.toggle("on",on);b.setAttribute("aria-pressed",on);
  }
  draw();table();
}
async function loadRows(keepDate=false){
  const address=state.address;
  const rows=address?await api("/api/records?address="+encodeURIComponent(address)):[];
  if(address!==state.address)return;
  state.rows=rows;
  if(!keepDate || state.start===null){
    const anchor=midnight(rows.length?shiftedDate(rows.at(-1)):Date.now()+8*hourMs);
    setWindow(naturalStart(anchor,state.period),anchor);
  }
  $("summary").textContent=rows.length?"已归档 "+num(rows.length)+" 条小时记录 · "+rows[0][0].slice(0,10)+" 起":address?"设备已登记，刷新蓝牙数据后可查看记录。":"添加第一台温湿度计，开始查看历史记录。";
  $("lcdT").textContent=rows.length?num(rows.at(-1)[2]):"--";$("lcdH").textContent=rows.length?rows.at(-1)[4]:"--";
  $("lcdCaption").textContent=rows.length?rows.at(-1)[0].slice(5,16).replace("T"," ")+" · 小时最高值":"最近一小时 · 最高值";
  $("download").setAttribute("aria-disabled",!rows.length);$("download").href="/download?address="+encodeURIComponent(address);
  render();
}
function deviceList(){
  const entries=Object.entries(state.devices);
  closePicker();
  $("deviceOptions").replaceChildren();$("known").replaceChildren();
  for(const [address,name] of entries){
    const option=document.createElement("li");
    option.setAttribute("role","option");
    option.dataset.address=address;
    option.id="option-"+address.replaceAll(":","");
    const label=document.createElement("span");
    label.textContent=name;
    const suffix=document.createElement("small");
    suffix.textContent=address.slice(-5);
    option.append(label,suffix);
    $("deviceOptions").append(option);
    const row=document.createElement("div");
    row.className="knownrow";
    const info=document.createElement("div");
    info.className="device-id";
    const small=document.createElement("small");
    small.textContent=address;
    info.append(name,small);
    const edit=document.createElement("button");
    edit.className="edit-alias";
    edit.textContent="改别名";
    edit.setAttribute("aria-label","修改 "+name+" 的别名");
    edit.onclick=()=>{
      $("aliasAddress").textContent=address;
      $("aliasName").value=name;
      $("aliasForm").hidden=false;
      $("aliasName").select();
    };
    row.append(info,edit);
    $("known").append(row);
  }
  $("device").disabled=!entries.length;
  showCurrentDevice();
}
async function poll(force=false){
  const s=await api("/api/state"), changed=JSON.stringify(s.devices)!==JSON.stringify(state.devices);
  const completed=state.revision!==null && state.revision!==s.task.revision;
  state.task=s.task;state.revision=s.task.revision;state.devices=s.devices;
  if(!state.devices[state.address])state.address=Object.keys(state.devices)[0]||"";
  if(force||changed)deviceList();
  $("scan").disabled=$("merge").disabled=s.task.busy;$("sync").disabled=s.task.busy||!state.address;
  if(s.task.message)msg(s.task.message);
  if(s.task.kind==="scan" && (completed||force)){
    $("found").replaceChildren();
    for(const a of s.task.found||[]){
      const btn=document.createElement("button");btn.textContent=(state.devices[a]||"未登记")+" · "+a;
      btn.onclick=()=>{$("mac").value=a;$("name").focus()};$("found").append(btn);
    }
  }
  if(force||changed||(completed&&s.task.kind!=="scan"))await loadRows(!changed&&!force);
}
function showCurrentDevice(){
  const name=state.devices[state.address] || "暂无设备";
  $("deviceName").textContent=name;
  $("deviceSuffix").textContent=state.address.slice(-5);
  $("device").setAttribute("aria-label","当前设备："+name+" "+state.address.slice(-5));
  for(const option of $("deviceOptions").children){
    option.setAttribute("aria-selected",option.dataset.address===state.address);
  }
}
function closePicker(){
  $("deviceOptions").hidden=true;
  $("device").setAttribute("aria-expanded","false");
  $("device").removeAttribute("aria-activedescendant");
}
function highlightOption(option){
  for(const item of $("deviceOptions").children)item.classList.toggle("highlight",item===option);
  $("device").setAttribute("aria-activedescendant",option.id);
  option.scrollIntoView({block:"nearest"});
}
function openPicker(){
  const options=$("deviceOptions");
  if(!options.children.length)return;
  options.hidden=false;
  $("device").setAttribute("aria-expanded","true");
  highlightOption(options.querySelector('[aria-selected="true"]') || options.firstElementChild);
}
async function selectOption(option){
  closePicker();
  $("device").focus();
  if(!option || option.dataset.address===state.address)return;
  state.address=option.dataset.address;
  showCurrentDevice();
  try{await loadRows()}catch(error){msg(error.message)}
}
$("device").onclick=()=>{$("deviceOptions").hidden?openPicker():closePicker()};
$("deviceOptions").onclick=e=>{
  const option=e.target.closest('[role="option"]');
  if(option)selectOption(option);
};
$("device").onkeydown=e=>{
  const options=$("deviceOptions");
  if(e.key==="Escape" && !options.hidden){e.preventDefault();closePicker();return}
  if(e.key==="Tab"){closePicker();return}
  if(!options.hidden && ["Enter"," "].includes(e.key)){
    e.preventDefault();selectOption(options.querySelector(".highlight"));return;
  }
  if(!["ArrowDown","ArrowUp","Home","End"].includes(e.key))return;
  e.preventDefault();
  if(options.hidden){openPicker();return}
  const current=options.querySelector(".highlight");
  const target={Home:options.firstElementChild,End:options.lastElementChild,
                ArrowDown:current.nextElementSibling,ArrowUp:current.previousElementSibling}[e.key];
  if(target)highlightOption(target);
};
document.addEventListener("pointerdown",e=>{if(!$("picker").contains(e.target))closePicker()});
$("device").onblur=closePicker;
$("deviceOptions").onmousedown=e=>e.preventDefault();
$("period").onclick=e=>{
  const period=e.target.dataset.p;
  if(!period || period===state.period)return;
  state.period=period;
  const anchor=state.anchor??midnight(Date.now()+8*hourMs);
  setWindow(naturalStart(anchor,period),anchor);
  render();
};
$("resolution").onclick=e=>{
  if(!e.target.dataset.unit)return;
  state.units[state.period]=e.target.dataset.unit;
  render();
};
$("date").onchange=()=>{
  if(!$("date").value)return;
  setWindow(Date.parse($("date").value+"T00:00:00Z"));
  render();
};
for(const [id,dir] of [["prev",-1],["next",1]])bind(id,()=>{
  const aligned=naturalStart(state.start,state.period);
  const target=dir<0 && aligned<state.start?aligned:movePeriod(aligned,dir,state.period);
  setWindow(target);
  render();
});
function pan(dir){
  if(state.period==="all")return;
  const months=state.units[state.period]==="month";
  const target=months?monthShift(state.start,dir,state.preferredDay):
    state.start+dir*(state.period==="day"?hourMs:dayMs);
  setWindow(target,target,months?state.preferredDay:new Date(target).getUTCDate());
  render();
}
bind("nextPage",()=>{state.page++;table()});bind("previousPage",()=>{state.page--;table()});
for(const id of ["manage","add"])bind(id,()=>{$("dialog").showModal()});
bind("close",()=>$("dialog").close());
$("dialog").addEventListener("close",()=>{$("aliasForm").hidden=true});
bind("cancelAlias",()=>{$("aliasForm").hidden=true});
$("aliasForm").onsubmit=async event=>{
  event.preventDefault();
  const address=$("aliasAddress").textContent;
  const name=$("aliasName").value.trim();
  $("saveAlias").disabled=true;
  try{
    await post("/api/devices/rename",{address,name});
    state.devices[address]=name;
    deviceList();
    $("aliasForm").hidden=true;
    msg("设备别名已更新为「"+name+"」。");
  }catch(error){msg(error.message)}
  finally{$("saveAlias").disabled=false}
};
for(const id of ["scan","sync","merge"])bind(id,async()=>{
  if(id==="scan")$("found").replaceChildren();
  await post("/api/"+id,id==="sync"?{address:state.address}:{});await poll();
});
$("form").onsubmit=async e=>{
  e.preventDefault();
  try{const address=$("mac").value.trim().replaceAll("-",":").toUpperCase();
    await post("/api/devices",{name:$("name").value,address});state.address=address;await poll(true);
    $("dialog").close();$("form").reset();msg("设备已保存，点击「刷新蓝牙数据」读取历史记录。");
  }catch(error){msg(error.message)}
};
function pointAt(clientX,rect){
  const fraction=(clientX-rect.left-axisLabelWidth)/Math.max(1,rect.width-axisLabelWidth-rightInset);
  return Math.max(0,Math.min(buckets.length-1,Math.round(fraction*(buckets.length-1))));
}
const observer=new ResizeObserver(draw);
for(const item of series){
  const canvas=$(item.canvas),plot=canvas.parentElement;
  observer.observe(canvas);
  plot.onpointermove=e=>{
    const index=pointAt(e.clientX,canvas.getBoundingClientRect());
    if(state.selected!==index){state.selected=index;draw()}
  };
  plot.onpointerleave=plot.onblur=()=>{state.selected=-1;draw()};
  plot.onkeydown=e=>{
    if(!["ArrowLeft","ArrowRight"].includes(e.key))return;
    e.preventDefault();state.selected=Math.max(0,Math.min(buckets.length-1,state.selected+(e.key==="ArrowRight"?1:-1)));draw();
  };
  let accumulated=0,lastWheel=0;
  plot.addEventListener("wheel",e=>{
    if(state.period==="all" || state.start===null || e.ctrlKey)return;
    const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
    if(!delta)return;
    e.preventDefault();
    const now=performance.now();
    if(now-lastWheel>180 || Math.sign(delta)!==Math.sign(accumulated))accumulated=0;
    lastWheel=now;
    accumulated+=delta*(e.deltaMode===1?32:e.deltaMode===2?100:1);
    if(Math.abs(accumulated)<24)return;
    pan(Math.sign(accumulated));
    accumulated=0;
    state.selected=pointAt(e.clientX,canvas.getBoundingClientRect());draw();
  },{passive:false});
}
async function monitor(){
  try{await poll(state.revision===null)}catch(e){msg("无法读取本地服务。"+e.message)}
  setTimeout(monitor,state.task.busy?900:3000);
}
monitor();

