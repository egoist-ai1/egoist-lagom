"""Send ASCII text only to one of this task's isolated QEMU guest keyboards."""
import json
import socket
import sys
import time
port=int(sys.argv[1])
slow='--slow' in sys.argv[3:]
if port not in (4444,4445):
    raise SystemExit('Only Shield lab QMP ports are allowed')
keys={' ':'spc',':':'shift-semicolon',';':'semicolon','\\':'backslash','/':'slash','-':'minus','_':'shift-minus','.':'dot',',':'comma','"':'shift-apostrophe',"'":'apostrophe','&':'shift-7','|':'shift-backslash','=':'equal','(':'shift-9',')':'shift-0','$':'shift-4','>':'shift-dot'}
with socket.create_connection(('127.0.0.1',port),timeout=10) as c:
    f=c.makefile('rwb'); f.readline()
    def qmp(name,args=None):
        f.write((json.dumps({'execute':name,'arguments':args or {}})+'\r\n').encode());f.flush()
        while True:
            response=json.loads(f.readline())
            if 'event' not in response:
                if 'error' in response: raise RuntimeError(response['error'])
                return response
    qmp('qmp_capabilities')
    for char in sys.argv[2]:
        if '--alt-codes' in sys.argv[3:]:
            if not char.isascii() or ord(char) < 32: raise ValueError('Printable ASCII only')
            def key_event(key, down):
                qmp('input-send-event', {'events': [{'type':'key','data':{'down':down,'key':{'type':'qcode','data':key}}}]})
                time.sleep(.18 if slow else .08)
            key_event('alt', True)
            for digit in '0' + str(ord(char)):
                key_event('kp_' + digit, True)
                key_event('kp_' + digit, False)
            key_event('alt', False)
            continue
        key=keys.get(char,'shift-'+char.lower() if char.isupper() else char)
        if not (char.isascii() and (char.isalnum() or char in keys)): raise ValueError('Unsupported character')
        qmp('human-monitor-command',{'command-line':'sendkey '+key+(' 80' if slow else ' 20')})
        time.sleep(.45 if slow else .22)
