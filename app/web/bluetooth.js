"use strict";
const SensorHistory=(()=>{
  const uuid=short=>"ebe0"+short+"-7a0a-4b0c-8a1a-6ff2997da3a6";
  function choose(){
    if(!navigator.bluetooth?.requestDevice)throw Error("当前浏览器无法连接蓝牙，请用桌面 Chrome 打开；已有 CSV 仍可查看。");
    // Some stock devices advertise MiBeacon without a local name.
    return navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[uuid("ccb0")]});
  }
  function unpack(view,origin){
    if(view.byteLength!==14)throw Error("设备历史记录格式不匹配。");
    const seq=view.getUint32(0,true),tick=view.getUint32(4,true);
    const high=view.getInt16(8,true)/10,wet=view.getUint8(10),low=view.getInt16(11,true)/10,dry=view.getUint8(13);
    if(low>high || dry>wet || wet>100)throw Error("设备返回了无效的温湿度范围。");
    const time=new Date(origin+tick*1000+8*3600000).toISOString().slice(0,19)+"+08:00";
    return [seq,time,low.toFixed(1),high.toFixed(1),dry,wet,tick].map(String);
  }
  async function collect(device,report){
    let history,onPacket,onLost,timer;
    try{
      const server=await device.gatt.connect();
      const service=await server.getPrimaryService(uuid("ccb0"));
      const clock=await (await service.getCharacteristic(uuid("ccb7"))).readValue();
      const origin=Date.now()-clock.getUint32(0,true)*1000;
      const counts=await (await service.getCharacteristic(uuid("ccb9"))).readValue();
      const retained=counts.getUint32(4,true);
      if(!retained)return [];
      history=await service.getCharacteristic(uuid("ccbc"));
      report("已连接，准备读取 "+retained.toLocaleString()+" 条历史记录。");
      const records=new Map();
      await new Promise((resolve,reject)=>{
        const resetTimer=()=>{
          clearTimeout(timer);
          timer=setTimeout(()=>reject(Error("设备连续 35 秒没有返回新记录。已读取 "+records.size+" / "+retained+" 条，请重新刷新。")),35000);
        };
        onLost=()=>reject(Error("蓝牙连接已断开，请靠近设备后重新刷新。"));
        onPacket=event=>{
          try{
            const row=unpack(event.target.value,origin);
            if(records.has(row[0]))return;
            records.set(row[0],row);
            resetTimer();
            if(records.size===1 || records.size%50===0)report("已读取 "+records.size.toLocaleString()+" / "+retained.toLocaleString()+" 条");
            if(records.size===retained)resolve();
          }catch(error){reject(error)}
        };
        history.addEventListener("characteristicvaluechanged",onPacket);
        device.addEventListener("gattserverdisconnected",onLost);
        resetTimer();
        history.startNotifications().catch(reject);
      });
      return [...records.values()];
    }finally{
      clearTimeout(timer);
      if(onPacket)history.removeEventListener("characteristicvaluechanged",onPacket);
      if(onLost)device.removeEventListener("gattserverdisconnected",onLost);
      if(device.gatt.connected)device.gatt.disconnect();
    }
  }
  return {choose,collect};
})();
