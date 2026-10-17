// Current integration limits; historical probes are not current staffing evidence.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const log=readFileSync(process.argv[2],'utf8'),count=n=>Number(log.match(new RegExp('^ℹ '+n+' (\\d+)','m'))?.[1]);
if(!count('tests')||count('tests')!==count('pass')||count('fail')!==0)throw Error('Successful full contract log required');
const report={format:'bve-host-project-integration-v1',sourceCommit,generatedAt:new Date().toISOString(),kind:'integration-limits-with-authored-contract-evidence',contractResults:{total:count('tests'),passed:count('pass'),failed:count('fail')},
 currentRoster:{conductor:'1 SOL',butler:'1 on-demand LUNA',workers:'0–6 bounded LUNA',maximum:8,supervisors:0},
 demonstrated:'See evidence/project-report.json and browser-report.json: authored scoped operations and browser presentation, not native staff',
 operationalInstallation:{status:'incomplete',preservedWindowsRootModified:false,readyConductorSessionUrl:null,reason:'No connected Windows project/root or demonstrated actual SOL/LUNA worker byte-return and initiating-interaction completion route in this run'},
 unverified:['Actual host SOL/LUNA provisioning/resume under the current roster','Native image-tool original return from exact assigned worker','Butler opening the local browser through host tooling','Automatic completion in the originating user interaction','Actual native concurrency, OS recovery and human usefulness/acceptance'],
 historicalEvidence:'Previous role-session probe belongs to bdde9241e9afff2478a133a0c7586af8ca808587 and its earlier contract; it is not current project-workforce verification'};
writeFileSync('evidence/host-installation-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sourceCommit,contracts:count('pass'),operational:'incomplete'}));
