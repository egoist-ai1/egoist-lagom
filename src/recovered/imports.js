import { execFile, spawn, spawnSync } from "node:child_process";
import fs, { createReadStream, promises } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, ipcMain, nativeImage, powerMonitor, screen, session, shell } from "electron";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import dgram, { createSocket } from "node:dgram";
import log from "electron-log";
import { parse } from "yaml";
import os, { hostname, tmpdir } from "node:os";
import net, { Socket, createConnection, createServer, isIP } from "node:net";
import { z } from "zod";
import dns, { Resolver, lookup } from "node:dns/promises";
import fs$1 from "node:fs/promises";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import { promises as promises$1 } from "node:dns";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
