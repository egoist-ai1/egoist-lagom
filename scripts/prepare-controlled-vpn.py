"""Create an isolated loopback VLESS peer for real guest VPN integration."""
import json
import uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1]
lab=root/'recovery/vpn-lab'
lab.mkdir(exist_ok=True)
credential=str(uuid.uuid4())
server={'log':{'level':'warn'},'inbounds':[{'type':'vless','listen':'127.0.0.1','listen_port':18083,'users':[{'uuid':credential}]}],'outbounds':[{'type':'direct','tag':'direct'}]}
node={'id':'controlled-lab','name':'Controlled laboratory peer','protocol':'vless','server':'10.0.2.2','port':18083,'metadata':{'id':credential,'uuid':credential,'security':'none','type':'tcp'}}
(lab/'server.json').write_text(json.dumps(server))
(lab/'controlled-state.json').write_text(json.dumps({'nodes':[node],'activeNodeId':node['id']}))
print('Prepared controlled loopback VLESS peer; credentials stored only in ignored lab files')
