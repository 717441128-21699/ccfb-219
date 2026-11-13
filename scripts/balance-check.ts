import { defaultScene } from '../src/sim/defaultScene';
import { simulateBatch } from '../src/sim/balancer';
const r = simulateBatch(defaultScene(), 100);
console.log('保障率', (r.departedRate * 100).toFixed(1) + '%');
console.log('延误', r.delayTicks);
console.log('重喷', r.reSprays);
console.log('罚则', r.fines);
console.log('预算', r.budget);
