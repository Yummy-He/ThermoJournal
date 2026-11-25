import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = name=>readFileSync(new URL("../app/web/"+name+".js",import.meta.url),"utf8");
const ctx=vm.createContext({crypto:globalThis.crypto,setTimeout,clearTimeout});
const archive=vm.runInContext(script("archive")+"\nArchive",ctx);
const sensor=vm.runInContext(script("bluetooth")+"\nSensorHistory",ctx);
const address="02:00:00:00:00:01";
const values=["7","2026-02-10T17:00:00+08:00","-1.2","4.5","45","52","28800"];
const device={address,name:'客厅,"北"',rows:[values]};
test("CSV quoting, old schema, duplicate exports, different boot times and conflicts",()=>{
  const csv=archive.encode([device]), result=archive.parse(csv);
  assert.equal(result[0].name,device.name);
  assert.deepEqual([...result[0].values],values);
  const raw=csv.split("\r\n")[0].split(",").slice(2).join(",")+"\r\n"+values.join(",");
  assert.equal(archive.parse(raw,device)[0].address,address);
  const drift=[...values];drift[1]="2026-02-10T17:01:30+08:00";drift[3]="4.50";
  const reset=[...values];reset[1]="2026-03-01T17:00:00+08:00";
  assert.equal(archive.merge([values],[drift,reset]).length,2);
  drift[2]="-2";assert.throws(()=>archive.merge([values],[drift]),/冲突/);
});
test("BLE uses original little-endian packet, distinct indices and disconnect cleanup",async()=>{
  const channel=new EventTarget(), peer=new EventTarget();
  const clock=new DataView(new ArrayBuffer(4)),counts=new DataView(new ArrayBuffer(8));
  clock.setUint32(0,8000,true);counts.setUint32(4,2,true);
  function emit(seq){
    const v=new DataView(new ArrayBuffer(14));v.setUint32(0,seq,true);v.setUint32(4,seq*3600,true);
    v.setInt16(8,45,true);v.setUint8(10,52);v.setInt16(11,-12,true);v.setUint8(13,45);
    channel.value=v;channel.dispatchEvent(new Event("characteristicvaluechanged"));
  }
  const service={getCharacteristic:async id=>{
    if(id.startsWith("ebe0ccbc"))return channel;
    return {readValue:async()=>id.startsWith("ebe0ccb7")?clock:counts};
  }};
  peer.gatt={connected:false,connect:async()=>{peer.gatt.connected=true;return {getPrimaryService:async()=>service}},
    disconnect:()=>{peer.gatt.connected=false}};
  channel.startNotifications=async()=>{emit(1);emit(1);emit(2)};
  const rows=await sensor.collect(peer,()=>{});
  assert.equal(rows.length,2);
  assert.deepEqual([...rows[0].slice(2)],["-1.2","4.5","45","52","3600"]);
  assert.equal(peer.gatt.connected,false);
  channel.startNotifications=async()=>{emit(1);peer.dispatchEvent(new Event("gattserverdisconnected"))};
  await assert.rejects(sensor.collect(peer,()=>{}),/断开/);
});
