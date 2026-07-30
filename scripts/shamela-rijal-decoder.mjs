/**
 * Decoder for the narrator registry in the official Maktabah Shamela v4
 * service database (S1.db).
 *
 * The byte map is derived from the MIT-licensed `shamela` package by Ragaeeb
 * Haq: https://github.com/ragaeeb/shamela/blob/main/scripts/shamela-decoder.ts
 * It is kept here because the public package does not export the development
 * decoder and the Atlas importer must run with Node alone.
 */

export const SHAMELA_NARRATOR_DECODER_VERSION = "shamela-s1-decoder-1.0.0";

const TEXT_MAP = {
  20: "", 64: " ", 67: "ن", 69: "ل", 70: "م", 71: "ه", 74: "", 75: "",
  77: "(", 79: '"', 85: "ي", 88: "ى", 89: "ك", 90: "\n", 91: "[", 93: ")",
  96: "و", 97: "/", 98: "آ", 99: "ؤ", 101: "ة", 102: "أ", 103: "إ",
  104: "ا", 105: "ر", 107: "\n", 112: "ّ", 113: "ة", 114: "ت", 115: "ث",
  116: "ب", 117: "ح", 118: "خ", 119: "د", 120: "ج", 121: "ث", 122: ":",
  127: "", 128: "ط", 129: "", 132: "", 133: "", 134: "", 135: "", 136: "",
  138: "", 139: "", 148: "و", 149: "", 153: "", 155: " ", 156: "و",
  158: "ئ", 162: "", 164: "", 166: "", 168: "", 170: "،", 171: "و",
  172: "ذ", 173: "ف", 174: "ق", 192: "", 204: "ِ", 205: "ٍ", 206: "َ",
  207: "ُ", 208: "", 222: "ْ", 224: "\n", 235: "ش", 236: "ض", 237: "ز",
  238: "س", 239: "ص", 240: "0", 241: "1", 242: "2", 243: "3", 244: "4",
  245: "5", 246: "6", 247: "7", 248: "8", 249: "9", 251: "غ", 252: "ـ",
  253: "ظ", 254: "ع", 255: "غ",
};

const METADATA_MAP = { ...TEXT_MAP, 107: ":", 148: "" };

function decodeBytes(blob, mapping) {
  if (!blob) return "";
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  let result = "";
  for (const byte of bytes) {
    result += mapping[byte] ?? `[${byte.toString(16).padStart(2, "0")}]`;
  }
  return result.trim();
}

export function decodeShamelaNarratorText(blob) {
  return decodeBytes(blob, TEXT_MAP);
}

export function decodeShamelaNarratorMetadata(blob) {
  return decodeBytes(blob, METADATA_MAP)
    .replace(/^:\s*/, "")
    .replace(/\n:\s*/g, "\n")
    .trim();
}

export function containsUndecodedShamelaBytes(value) {
  return /\[[0-9a-f]{2}\]/i.test(value ?? "");
}
