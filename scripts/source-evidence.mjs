// Record exact committed source bytes, never CRLF-converted checkout bytes.
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const log=readFileSync(process.argv[2],'utf8'),browser=JSON.parse(readFileSync('evidence/browser-report.json')),repair=JSON.parse(readFileSync('evidence/repair-report.json')),host=JSON.parse(readFileSync('evidence/host-installation-report.json'));
const count=name=>Number(log.match(new RegExp('^ℹ '+name+' (\\d+)','m'))?.[1]);
const total=count('tests'),passed=count('pass'),failed=count('fail');
if(!total||total!==passed||failed!==0||browser.errors.length||!browser.checks.length)throw Error('Cannot publish evidence for a failed/incomplete verification');
if(browser.sourceCommit!==sourceCommit||repair.sourceCommit!==sourceCommit||host.sourceCommit!==sourceCommit)throw Error('Reports do not refer to this tested source commit');
execFileSync('git',['diff','--exit-code','HEAD','--','src','public','scripts','test','docs/roles','package.json','package-lock.json']);
const files=execFileSync('git',['ls-files','-z','--','src','public','scripts','test','docs/roles','package.json','package-lock.json'],{encoding:'utf8'}).split('\0').filter(Boolean);
const sourceHashes=Object.fromEntries(files.map(path=>[path,createHash('sha256').update(execFileSync('git',['show',sourceCommit+':'+path])).digest('hex')]));
const manifest={generatedAt:new Date().toISOString(),sourceCommit,sourceBytes:'committed Git blobs; no checkout line-ending conversion',result:'passed',command:'BVE_BROWSER_EXECUTABLE=/tmp/bve-host-chromium npm run verify; npm run evidence:repairs; node scripts/host-evidence.mjs VERIFICATION_LOG DISPOSABLE_PROBE_ROOT',runtime:process.version,playwright:JSON.parse(readFileSync('package.json')).devDependencies.playwright,browserEnvironment:{platform:process.platform,architecture:process.arch,version:browser.environment.browser,provisioning:'Test-only @sparticuz/chromium 153.0.0 from npm registry'},contracts:{total,passed,failed},hostInstallation:{report:'evidence/host-installation-report.json',operational:host.operationalInstallation.status,probe:host.actualCloudProbe.status},browser:{passed:browser.checks.length,failed:0,pageErrors:0},priorIndependentEvidence:{baseline:'115a07a34bd35d84ac00e45253671db4bb254888',windows:'Reported independent Node 24.19.0 contract suite: 20/20. Baseline shipped browser harness failed; explicit-wait diagnostic harness: 20/20. Not a Windows rerun of this repair.'},unexecuted:['Windows/macOS rerun of repaired checkpoint','full operator installation/OS permissions/process recovery','native workers/tools and native original-byte delivery','actual concurrent native execution','live push notifications','human usefulness/design acceptance','GitHub-hosted CI'],sourceHashes};
writeFileSync('evidence/checks.json',JSON.stringify(manifest,null,2)+'\n');writeFileSync('evidence/verification.log',log);
console.log(JSON.stringify({sourceCommit,committedSourceFiles:files.length,contracts:passed,browser:browser.checks.length}));
