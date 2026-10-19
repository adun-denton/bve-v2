// Fixed authored negative controls; never accepts a command or executable path.
if(process.argv[2]==='--authored-timeout')setInterval(()=>{},1000);
else {process.stderr.write('AUTHORED_PRE_BOUNDARY_FAILURE\n');process.exitCode=23;}
