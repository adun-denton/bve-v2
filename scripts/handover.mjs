#!/usr/bin/env node
import {handover} from '../src/handover.mjs';
const args=process.argv.slice(2),json=args.at(-1)==='--json';if(json)args.pop();
if(args.length!==2||args.some(x=>x.startsWith('--'))){console.error('Usage: node scripts/handover.mjs <absolute-business-root> <absolute-runtime-root> [--json]. Read-only; cannot start or install.');process.exitCode=2;}
else{const report=handover({businessRoot:args[0],runtimeRoot:args[1]});if(json)console.log(JSON.stringify(report,null,2));else{console.log('3DJAT handover: '+report.status+'; activation is blocked.');for(const r of report.rows)console.log(`Stage ${r.stage} | ${r.criterion}: ${r.status}\n  ${r.reason}\n  ${r.owner}: ${r.action}`);console.log('Optional technical details: repeat with --json.');}process.exitCode=1;}
