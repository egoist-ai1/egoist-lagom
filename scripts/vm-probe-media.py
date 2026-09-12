"""Build read-only supplementary guest diagnostics media, no OS boot files."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python-libs'))
import pycdlib
iso=pycdlib.PyCdlib()
iso.new(interchange_level=4,udf='2.60',vol_ident='SHIELDPROBE')
iso.add_file(str(ROOT/'tests/windows-lab-install-probe.ps1'),iso_path='/PROBE.PS1;1',udf_path='/probe.ps1')
iso.write(str(ROOT/'recovery/vm/diagnostic.iso'))
iso.close()
