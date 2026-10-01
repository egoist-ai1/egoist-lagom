"""Write and read back Electron's Windows ASAR header integrity resource."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', type=Path, required=True)
    parser.add_argument('--header-sha256', required=True)
    args = parser.parse_args()
    if sys.platform != 'win32' or not re.fullmatch(r'[a-f0-9]{64}', args.header_sha256):
        raise ValueError('Windows and an exact lowercase ASAR SHA256 are required')
    executable = args.executable.absolute()
    if not executable.is_file() or executable.is_symlink() or executable.stat().st_nlink != 1:
        raise ValueError('ASAR integrity requires an ordinary unlinked PE')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    kernel.BeginUpdateResourceW.restype = wintypes.HANDLE
    kernel.UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
    kernel.UpdateResourceW.restype = wintypes.BOOL
    kernel.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    kernel.EndUpdateResourceW.restype = wintypes.BOOL
    kernel.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    kernel.LoadLibraryExW.restype = wintypes.HMODULE
    kernel.FindResourceW.argtypes = [wintypes.HMODULE, wintypes.LPCWSTR, wintypes.LPCWSTR]
    kernel.FindResourceW.restype = wintypes.HANDLE
    kernel.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.SizeofResource.restype = wintypes.DWORD
    kernel.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.LoadResource.restype = wintypes.HANDLE
    kernel.LockResource.argtypes = [wintypes.HANDLE]
    kernel.LockResource.restype = ctypes.c_void_p
    kernel.FreeLibrary.argtypes = [wintypes.HMODULE]
    kernel.FreeLibrary.restype = wintypes.BOOL
    payload = json.dumps([{'file': r'resources\app.asar', 'alg': 'sha256', 'value': args.header_sha256}], separators=(',', ':')).encode('utf-8')
    update = kernel.BeginUpdateResourceW(str(executable), False)
    if not update:
        raise ctypes.WinError(ctypes.get_last_error())
    committed = False
    try:
        data = ctypes.create_string_buffer(payload)
        if not kernel.UpdateResourceW(update, 'INTEGRITY', 'ELECTRONASAR', 0, data, len(payload)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.EndUpdateResourceW(update, False):
            raise ctypes.WinError(ctypes.get_last_error())
        committed = True
    finally:
        if not committed:
            kernel.EndUpdateResourceW(update, True)
    # LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE: never execute PE.
    module = kernel.LoadLibraryExW(str(executable), None, 0x22)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        resource = kernel.FindResourceW(module, 'ElectronAsar', 'Integrity')
        if not resource:
            raise ctypes.WinError(ctypes.get_last_error())
        size = kernel.SizeofResource(module, resource)
        loaded = kernel.LoadResource(module, resource)
        address = kernel.LockResource(loaded) if loaded else None
        if not address or size != len(payload) or ctypes.string_at(address, size) != payload:
            raise ValueError('Embedded ASAR integrity resource readback failed')
    finally:
        kernel.FreeLibrary(module)
    print(json.dumps({'executable': str(executable), 'asarHeaderSha256': args.header_sha256, 'resourceVerified': True, 'executableSha256': hashlib.sha256(executable.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
