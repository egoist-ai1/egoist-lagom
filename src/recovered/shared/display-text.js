//#region src/shared/display-text.ts
var UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
function buildSingleByteEncoder(encoding) {
	const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
	const decoded = new TextDecoder(encoding).decode(bytes);
	const encoder = /* @__PURE__ */ new Map();
	Array.from(decoded).forEach((character, index) => {
		if (!encoder.has(character)) encoder.set(character, index);
	});
	return encoder;
}
var WINDOWS_1251_ENCODER = buildSingleByteEncoder("windows-1251");
var WINDOWS_1252_ENCODER = buildSingleByteEncoder("windows-1252");
function mojibakeScore(value) {
	const latinMarkers = value.match(/[ÃÂÐÑ]|â(?:€|„|“|”|€™|€¦|†|‡|€¢)/g)?.length ?? 0;
	const cyrillicMarkers = value.match(/[РС][\u0400-\u04ff\u2010-\u203a]/g)?.length ?? 0;
	const emojiMarkers = value.match(/(?:рџ|Рџ|пё|в(?:Ђ|‚|„|…|†|‡|€|™|љ|њ|ў|ќ|­))/gu)?.length ?? 0;
	return latinMarkers + cyrillicMarkers + emojiMarkers;
}
function decodeUtf8Candidate(value, byteForCharacter) {
	const bytes = [];
	for (const character of value) {
		const byte = byteForCharacter(character);
		if (byte == null) return null;
		bytes.push(byte);
	}
	try {
		return UTF8_DECODER.decode(Uint8Array.from(bytes));
	} catch {
		return null;
	}
}
function repairUtf8MojibakeOnce(value) {
	if (mojibakeScore(value) < 1) return value;
	return [
		decodeUtf8Candidate(value, (character) => {
			const code = character.codePointAt(0);
			return code != null && code <= 255 ? code : null;
		}),
		decodeUtf8Candidate(value, (character) => WINDOWS_1252_ENCODER.get(character) ?? null),
		decodeUtf8Candidate(value, (character) => WINDOWS_1251_ENCODER.get(character) ?? null)
	].filter((candidate) => Boolean(candidate)).reduce((best, candidate) => {
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(candidate)) return best;
		return mojibakeScore(candidate) < mojibakeScore(best) ? candidate : best;
	}, value);
}
function repairUtf8Mojibake(value) {
	let current = value;
	for (let pass = 0; pass < 3; pass += 1) {
		const repaired = repairUtf8MojibakeOnce(current);
		if (repaired === current || mojibakeScore(repaired) >= mojibakeScore(current)) break;
		current = repaired;
	}
	return current;
}
function normalizeDisplayText(value) {
	return repairUtf8Mojibake(value).normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\ufeff]/gu, "").replace(/\s+/gu, " ").trim();
}
//#endregion
