"""Fixed authored controller controls; no arbitrary command/worker executable."""
import importlib.util,json,pathlib,sys,time
sys.dont_write_bytecode=True
root=pathlib.Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('measure',root/'scripts/img20-measure.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
folder=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
if mode=='unsupported-host':m.platform.system=lambda:'Windows'
inputs=json.loads((folder/'inputs.json').read_text())
def barrier(initial):
    m.dump(folder/'backup-ready.json',{k:initial[k] for k in ['runtime','sourceRoot','origin']})
    deadline=time.monotonic()+20
    while not (folder/'continue').exists():
        if time.monotonic()>deadline:raise TimeoutError('Authored barrier timeout')
        time.sleep(.02)
budgets={'serverAbsoluteRssBytes':536870912,'serverRssDeltaBytes':402653184,'availablePhysicalRatioMinimum':.2}
if mode=='bad-budgets':budgets={}
try:
    m.run(root,inputs,folder,'controller',budgets,recovery=mode not in ['interrupt','bad-budgets'],authored_control=mode if mode in ['missing-marker','timeout','secondary'] else None,protocol_timeout=.00001 if mode=='protocol-timeout' else 30,after_backup=barrier if mode in ['held-lock','interrupt'] else None)
except BaseException:
    # Full errors are already private; never echo private protocol/state.
    sys.stderr.write('Authored controller failed; inspect private result\n');sys.exit(1)
