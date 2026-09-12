"""Isolated XHTTP peer: only the host loopback is exposed to disposable guests."""
import json
import uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1]
lab=root/'recovery/vpn-lab'
lab.mkdir(exist_ok=True)
credential=str(uuid.uuid4())
server={'log':{'loglevel':'warning'},'inbounds':[{'listen':'127.0.0.1','port':18084,'protocol':'vless','settings':{'clients':[{'id':credential}],'decryption':'none'},'streamSettings':{'network':'xhttp','security':'none','xhttpSettings':{'path':'/shield-lab/','mode':'auto'}}}],'outbounds':[{'protocol':'freedom','tag':'direct'}]}
node={'id':'controlled-xhttp','name':'Controlled XHTTP peer','protocol':'vless','server':'10.0.2.2','port':18084,'metadata':{'id':credential,'security':'none','type':'xhttp','path':'/shield-lab/','mode':'packet-up'}}
(lab/'xhttp-server.json').write_text(json.dumps(server))
(lab/'controlled-xhttp-state.json').write_text(json.dumps({'nodes':[node],'activeNodeId':node['id']}))
node['server']='127.0.0.1'
(lab/'controlled-xhttp-host-state.json').write_text(json.dumps({'nodes':[node],'activeNodeId':node['id']}))
print('Prepared local XHTTP peer; credentials retained only in ignored lab files')
