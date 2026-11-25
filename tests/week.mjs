import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("weekly controls group both metrics by hour and preserve calendar-week jumps",()=>{
  const nodes=new Map();
  function element(){
    return {children:[],dataset:{},classList:{toggle(){}},setAttribute(){},
      replaceChildren(){},append(){},addEventListener(type,handler){this[type]=handler},
      querySelectorAll(){return this.children}};
  }
  function get(id){
    if(!nodes.has(id)){
      const el=element();
      el.parentElement=element();
      el.getBoundingClientRect=()=>({left:0,width:500});
      el.clientWidth=0;
      nodes.set(id,el);
    }
    return nodes.get(id);
  }
  const units=["hour","day","month"].map(unit=>({...element(),dataset:{unit}}));
  get("resolution").children=units;
  const context=vm.createContext({
    standalone:{start:async()=>{}},ResizeObserver:class{observe(){}},performance,
    document:{getElementById:get,querySelectorAll:()=>[],createElement:element,addEventListener(){}}
  });
  const js=readFileSync(new URL("../app/web/ui.js",import.meta.url),"utf8");
  const run=code=>vm.runInContext(code,context);
  run(js);
  run('state.anchor=Date.UTC(2027,0,1);state.rows=[["2027-01-01T01:54:00+08:00",19,21,40,55],["2027-01-01T02:54:00+08:00",18,22,38,50]]');
  get("period").onclick({target:{dataset:{p:"week"}}});
  assert.equal(run("buckets.length"),7);
  assert.deepEqual(units.map(b=>b.hidden),[false,false,true]);
  get("resolution").onclick({target:units[0]});
  assert.equal(run("buckets.length"),168);
  assert.equal(run("iso(bounds[0])"),"2026-12-28");
  assert.equal(run("JSON.stringify(buckets.filter(b=>b.n).map(b=>[b.min,b.max]))"),
    JSON.stringify([[[19,40],[21,55]],[[18,38],[22,50]]]));
  get("humidityChart").parentElement.wheel({deltaY:100,deltaX:0,deltaMode:0,clientX:100,preventDefault(){}});
  assert.equal(run("clockLabel(bounds[0])"),"2026-12-28 01:00");
  get("next").click();
  assert.equal(run("clockLabel(bounds[0])"),"2027-01-04 00:00");
  get("date").value="2027-01-07";get("date").onchange();
  assert.equal(run("clockLabel(bounds[1])"),"2027-01-14 00:00");
  get("resolution").onclick({target:units[1]});
  assert.equal(run("buckets.length"),7);
  get("period").onclick({target:{dataset:{p:"half"}}});
  assert.deepEqual(units.map(b=>b.hidden),[true,false,false]);
});
