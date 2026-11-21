import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaultParams } from '../src/engine/defaults.ts';
import { exportAll, importAll, saveSchemes } from '../src/store/storage.ts';

class MemoryStorage {
  data = new Map<string,string>();
  failKey = '';
  getItem(k:string) { return this.data.get(k) ?? null; }
  setItem(k:string,v:string) { if(k===this.failKey) { this.failKey=''; throw new Error('quota'); } this.data.set(k,v); }
  removeItem(k:string) { this.data.delete(k); }
}
function setup() { const m=new MemoryStorage(); Object.defineProperty(globalThis,'localStorage',{value:m, configurable:true}); return m; }
test('备份排除两个 API 密钥',()=>{const m=setup();m.setItem('cbc.settings.v1',JSON.stringify({ai:{apiKey:'secret-a'},ocr:{cloudApiKey:'secret-b'}}));const json=JSON.stringify(exportAll());assert.ok(!json.includes('secret-a')&&!json.includes('secret-b'));});
test('拒绝损坏方案且不覆盖原数据',()=>{const m=setup();m.setItem('cbc.schemes.v1','old');assert.equal(importAll({schemes:[{}]}).ok,false);assert.equal(m.getItem('cbc.schemes.v1'),'old');});
test('中途写入失败回滚已写入项',()=>{const m=setup();m.setItem('cbc.draft.v1','old');m.setItem('cbc.schemes.v1','old-schemes');m.failKey='cbc.schemes.v1';const result=importAll({draft:{params:cloneDefaultParams(),doc:{no:'',client:'',date:'',note:''}},schemes:[]});assert.equal(result.ok,false);assert.equal(m.getItem('cbc.draft.v1'),'old');assert.equal(m.getItem('cbc.schemes.v1'),'old-schemes');});
test('保存方案写入失败向调用者报告',()=>{const m=setup();m.failKey='cbc.schemes.v1';assert.throws(()=>saveSchemes([]));});
